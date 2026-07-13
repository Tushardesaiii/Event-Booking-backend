import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { twilioService } from '../../lib/twilio.js';
import { badRequest, rateLimited, unauthorized, conflict, otpInvalid, otpExpired, otpAttemptsExceeded } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  createOtpVerification,
  findLatestActiveOtpVerification,
  incrementOtpAttempts,
  markOtpVerificationVerified,
  softDeleteOtpVerificationsForPhone,
  updateUserPhoneVerified,
  findUserByPhone
} from './verification.repository.js';
import { createSessionRecord, updateAuthAccountLastLoginAt, findAuthAccountsByUserId, createUserRecord, findUserByUsername } from './repository.js';
import { assertRateLimit } from '../../lib/rate-limiter.js';
import { notificationService } from '../notifications/service.js';
import { insertVerificationEvent } from '../notifications/repository.js';
import { marketingHooks } from '../marketing/hooks.js';
import { hashPassword } from '../../lib/password.js';
import { createTokenPair } from '../../lib/jwt.js';

export class OtpService {
  async sendOtp(input: {
    phoneNumber: string;
    purpose: 'signup' | 'login' | 'password_reset' | 'phone_change' | 'email_change';
    tenantId?: string | null;
    actorUserId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    logger.info('[OtpService] sendOtp request', {
      phoneNumber: input.phoneNumber,
      purpose: input.purpose,
      correlationId: input.correlationId
    });

    // 1. Rate Limit Check
    await assertRateLimit({
      source: 'otp',
      phoneNumber: input.phoneNumber,
      actorUserId: input.actorUserId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      requestId: input.requestId
    });

    if (!env.AUTH_BYPASS_OTP_VERIFICATION) {
      await twilioService.sendOtp(input.phoneNumber, input.purpose, {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        requestId: input.requestId
      });

      const user = await findUserByPhone(db, input.phoneNumber);
      const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);
      await db.transaction(async (tx) => {
        await softDeleteOtpVerificationsForPhone(tx, input.phoneNumber, input.purpose);
        await createOtpVerification(tx, {
          userId: user ? user.id : null,
          phoneNumber: input.phoneNumber,
          otpHash: 'twilio-verify-managed',
          purpose: input.purpose,
          expiresAt
        });
      });

      return { success: true, message: 'OTP sent successfully' };
    }

    // 2. Lookup user and check purpose enumeration
    const user = await findUserByPhone(db, input.phoneNumber);

    if (input.purpose !== 'signup' && !user) {
      logger.warn('[OtpService] Phone not registered for non-signup purpose. Enumeration protection active.', {
        phoneNumber: input.phoneNumber,
        purpose: input.purpose
      });
      // Append simulated event
      await insertVerificationEvent(db, {
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        eventType: 'send_simulated',
        source: 'otp',
        phoneNumber: input.phoneNumber,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        provider: env.SMS_PROVIDER,
        providerStatus: 'skipped_not_found',
        correlationId: input.correlationId,
        requestId: input.requestId,
        metadata: { info: 'Simulated send for non-existent phone number' }
      });
      return { success: true, message: 'OTP sent successfully' };
    }

    // 3. Generate OTP & Hash
    const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

    // 4. Transactional cleanup and insert
    await db.transaction(async (tx) => {
      await softDeleteOtpVerificationsForPhone(tx, input.phoneNumber, input.purpose);
      await createOtpVerification(tx, {
        userId: user ? user.id : null,
        phoneNumber: input.phoneNumber,
        otpHash,
        purpose: input.purpose,
        expiresAt
      });
    });

    // 5. Send Notification
    await notificationService.sendOtp({
      phoneNumber: input.phoneNumber,
      otp,
      purpose: input.purpose,
      expiresInMinutes: env.OTP_EXPIRY_MINUTES,
      tenantId: input.tenantId,
      actorUserId: user ? user.id : null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      correlationId: input.correlationId,
      requestId: input.requestId,
      eventType: 'sent'
    });

    return { success: true, message: 'OTP sent successfully' };
  }

  async verifyOtp(input: {
    phoneNumber: string;
    purpose: 'signup' | 'login' | 'password_reset' | 'phone_change' | 'email_change';
    code: string;
    tenantId?: string | null;
    actorUserId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    logger.info('[OtpService] verifyOtp request', {
      phoneNumber: input.phoneNumber,
      purpose: input.purpose,
      correlationId: input.correlationId
    });

    const isBypass = env.AUTH_BYPASS_OTP_VERIFICATION;
    if (!isBypass) {
      const isValid = await twilioService.verifyOtp(input.phoneNumber, input.code, input.purpose, {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        requestId: input.requestId
      });

      const otpRecord = await findLatestActiveOtpVerification(db, input.phoneNumber, input.purpose);
      if (otpRecord) {
        await markOtpVerificationVerified(db, otpRecord.id);
      }

      let user = await findUserByPhone(db, input.phoneNumber);
      if (!user && input.purpose === 'signup') {
        user = await this.provisionConsumerUser(input.phoneNumber);
      }
      if (user) {
        await updateUserPhoneVerified(db, user.id, new Date());
        await marketingHooks.onOtpVerified(
          { ...user, phoneNumber: user.phoneNumber ?? input.phoneNumber },
          { tenantId: input.tenantId }
        );

        if (input.purpose === 'login' || input.purpose === 'signup') {
          return this.createAuthSession(user, input);
        }
      }
      return { success: true, message: 'OTP verified successfully' };
    }
    const otpRecord = await findLatestActiveOtpVerification(db, input.phoneNumber, input.purpose);

    if (!otpRecord) {
      if (isBypass) {
        logger.warn('[OtpService] Active OTP record not found, but bypass is enabled. Checking if user exists.');
        let user = await findUserByPhone(db, input.phoneNumber);
        if (!user && input.purpose === 'signup') {
          user = await this.provisionConsumerUser(input.phoneNumber);
        }
        if (user && (input.purpose === 'login' || input.purpose === 'signup')) {
          return this.createAuthSession(user, input);
        }
        return { success: true, message: 'OTP verified successfully' };
      }
      throw badRequest('Invalid code or expired');
    }

    const now = new Date();
    
    // Increment attempts (except in bypass mode)
    let attempts = otpRecord.attempts;
    if (!isBypass) {
      const updated = await incrementOtpAttempts(db, otpRecord.id);
      attempts = updated ? updated.attempts : otpRecord.attempts + 1;
    }

    if (!isBypass && attempts > env.OTP_MAX_ATTEMPTS) {
      await insertVerificationEvent(db, {
        actorUserId: otpRecord.userId,
        tenantId: input.tenantId,
        eventType: 'failure',
        source: 'otp',
        phoneNumber: input.phoneNumber,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        correlationId: input.correlationId,
        requestId: input.requestId,
        metadata: { otpId: otpRecord.id, reason: 'max_attempts_exceeded' }
      });
      throw otpAttemptsExceeded();
    }

    // Check expiration
    const isExpired = otpRecord.expiresAt < now;
    if (!isBypass && isExpired) {
      await insertVerificationEvent(db, {
        actorUserId: otpRecord.userId,
        tenantId: input.tenantId,
        eventType: 'expired',
        source: 'otp',
        phoneNumber: input.phoneNumber,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        correlationId: input.correlationId,
        requestId: input.requestId,
        metadata: { otpId: otpRecord.id }
      });
      throw otpExpired();
    }

    // Check code match
    const inputHash = createHash('sha256').update(input.code.trim()).digest('hex');
    const isMatch = otpRecord.otpHash === inputHash;

    if (!isBypass && !isMatch) {
      await insertVerificationEvent(db, {
        actorUserId: otpRecord.userId,
        tenantId: input.tenantId,
        eventType: 'failure',
        source: 'otp',
        phoneNumber: input.phoneNumber,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        correlationId: input.correlationId,
        requestId: input.requestId,
        metadata: { otpId: otpRecord.id, reason: 'code_mismatch', attemptCount: attempts }
      });
      throw otpInvalid();
    }

    // Success flow in transaction
    let user = await db.transaction(async (tx) => {
      await markOtpVerificationVerified(tx, otpRecord.id);
      
      let verifiedUser = null;
      if (otpRecord.userId) {
        verifiedUser = await updateUserPhoneVerified(tx, otpRecord.userId, new Date());
      } else {
        // Find user by phone if userId is not on the record (e.g. signup)
        verifiedUser = await findUserByPhone(tx, input.phoneNumber);
        if (verifiedUser) {
          verifiedUser = await updateUserPhoneVerified(tx, verifiedUser.id, new Date());
        }
      }

      await insertVerificationEvent(tx, {
        actorUserId: otpRecord.userId,
        tenantId: input.tenantId,
        eventType: 'verify_success',
        source: 'otp',
        phoneNumber: input.phoneNumber,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        correlationId: input.correlationId,
        requestId: input.requestId,
        metadata: { otpId: otpRecord.id, bypassed: isBypass, attemptCount: attempts }
      });

      return verifiedUser;
    });

    if (!user && input.purpose === 'signup') {
      user = await this.provisionConsumerUser(input.phoneNumber);
    }

    if (user) {
      await marketingHooks.onOtpVerified(
        { ...user, phoneNumber: user.phoneNumber ?? input.phoneNumber },
        { tenantId: input.tenantId }
      );

      if (input.purpose === 'login' || input.purpose === 'signup') {
        return this.createAuthSession(user, input);
      }
    }

    return { success: true, message: 'OTP verified successfully' };
  }

  /**
   * Creates a minimal consumer account for a freshly verified phone number that
   * has no existing user. Consumers authenticate purely via phone OTP, so there
   * is no email/password auth account — profile details are filled in later via
   * the profile module. Username is derived from the phone number and made unique.
   */
  private async provisionConsumerUser(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    const suffix = digits.slice(-10) || digits;
    let username = `u${suffix}`;

    let existing = await findUserByUsername(db, username);
    while (existing) {
      username = `u${suffix}${randomBytes(2).toString('hex')}`;
      existing = await findUserByUsername(db, username);
    }

    const user = await createUserRecord(db, {
      username,
      full_name: 'Guest',
      phoneNumber,
      phoneVerifiedAt: new Date(),
      marketingOptIn: false
    });

    if (!user) {
      throw badRequest('Unable to create user');
    }

    logger.info('[OtpService] Provisioned new consumer user via phone OTP', {
      userId: user.id,
      phoneNumber
    });

    return user;
  }

  private async createAuthSession(user: any, input: any) {
    const sessionId = randomUUID();
    const tokens = createTokenPair(
      {
        sub: user.id,
        sid: sessionId,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: true
      },
      {
        accessSecret: env.ACCESS_TOKEN_SECRET,
        refreshSecret: env.REFRESH_TOKEN_SECRET,
        accessExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
        refreshExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN
      }
    );

    const refreshTokenHash = await hashPassword(tokens.refreshToken);
    const authSession = await createSessionRecord(db, {
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      userAgent: input.userAgent || null,
      ipAddress: input.ipAddress || null
    });

    if (!authSession) {
      throw badRequest('Unable to create session');
    }

    return {
      success: true,
      message: 'OTP verified successfully',
      data: {
        user,
        session: {
          id: authSession.id,
          expiresAt: authSession.expiresAt
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: {
            accessToken: env.ACCESS_TOKEN_EXPIRES_IN,
            refreshToken: env.REFRESH_TOKEN_EXPIRES_IN
          }
        }
      }
    };
  }
}

export const otpService = new OtpService();
