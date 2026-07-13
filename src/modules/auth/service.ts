import { randomUUID } from 'node:crypto';

import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { createTokenPair, verifyJwt } from '../../lib/jwt.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { marketingHooks } from '../marketing/hooks.js';
import { logger } from '../../lib/logger.js';
import { badRequest, conflict, otpInvalid, otpExpired, unauthorized, verificationSessionNotFound, rateLimited, otpAttemptsExceeded, phoneNotSupported } from '../../lib/errors.js';
import { normalizePhoneNumber } from '../../lib/phone.js';
import { twilioService } from '../../lib/twilio.js';
import {
  claimSignupVerificationAttempt,
  countSignupVerificationAuditEvents,
  createAuditLogRecord,
  createSignupVerificationSession,
  createAuthAccount,
  createSessionRecord,
  createUserRecord,
  deleteSessionById,
  findAuthAccountByProviderAndAccountId,
  findAuthAccountsByUserId,
  findSignupVerificationSessionById,
  findUserByPhoneNumber,
  findUserByUsername,
  findMembershipsForUser,
  findSessionById,
  findUserById,
  markSignupVerificationSessionCancelled,
  markSignupVerificationSessionExpired,
  markSignupVerificationSessionVerified,
  updateAuthAccountLastLoginAt,
  updateSignupVerificationSessionVerificationSid,
  updateSessionRefreshTokenHash
} from './repository.js';
import type {
  AuthMeResponse,
  AuthResult,
  LoginInput,
  LogoutInput,
  OrganizerRegisterInput,
  RefreshInput,
  SignupResendInput,
  SignupStartInput,
  SignupStartResponse,
  SignupVerifyInput
} from './types.js';
import type { JwtTokenClaims } from '../../types/auth.js';
import { createTenantRecord, createTenantMemberRecord } from '../tenants/repository.js';
import { createUniqueSlug } from '../../lib/slug.js';

type AuthUserRow = NonNullable<Awaited<ReturnType<typeof findUserById>>>;
type AuthAuditDatabase = Parameters<typeof createAuditLogRecord>[0];

function toPublicUser(user: AuthUserRow) {
  return user;
}

function decodeRefreshToken(refreshToken: string) {
  try {
    return verifyJwt<JwtTokenClaims>(refreshToken, env.REFRESH_TOKEN_SECRET, 'refresh');
  } catch (err: any) {
    throw unauthorized('Invalid refresh token');
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string) {
  return username.trim();
}

function normalizeFullName(fullName: string) {
  return fullName.trim();
}

function toSignupSessionExpiresAt() {
  return new Date(Date.now() + 15 * 60 * 1000);
}

function isSignupVerificationComplete(session: Awaited<ReturnType<typeof findSignupVerificationSessionById>>) {
  return !!session && session.status === 'verified';
}

async function assertSignupIdentityAvailability(normalizedEmail: string, normalizedUsername: string, normalizedPhoneNumber: string) {
  const [existingAccount, existingUserByUsername, existingUserByPhone] = await Promise.all([
    findAuthAccountByProviderAndAccountId(db, 'email', normalizedEmail),
    findUserByUsername(db, normalizedUsername),
    findUserByPhoneNumber(db, normalizedPhoneNumber)
  ]);

  if (existingAccount || existingUserByUsername || existingUserByPhone) {
    throw conflict('Unable to start signup');
  }
}

async function assertSignupVerificationRequestRateLimit(phoneNumber: string, ipAddress: string | null) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [phoneCount, ipCount] = await Promise.all([
    countSignupVerificationAuditEvents(db, { phoneNumber, since }),
    ipAddress ? countSignupVerificationAuditEvents(db, { ipAddress, since }) : Promise.resolve(0)
  ]);

  if (phoneCount >= 3 || ipCount >= 3) {
    throw rateLimited('Too many verification requests');
  }
}

async function logSignupAuditEvent(
  database: AuthAuditDatabase,
  eventType: 'signup_started' | 'otp_sent' | 'otp_resend' | 'otp_verified' | 'otp_failed' | 'signup_completed',
  payload: {
    correlationId: string;
    phoneNumber?: string | null;
    email?: string | null;
    username?: string | null;
    entityId?: string | null;
    actorUserId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await createAuditLogRecord(database, {
    eventType,
    actorType: payload.actorUserId ? 'user' : 'anonymous',
    actorUserId: payload.actorUserId,
    entityType: 'signup_verification_session',
    entityId: payload.entityId ?? null,
    phoneNumber: payload.phoneNumber ?? null,
    email: payload.email ?? null,
    username: payload.username ?? null,
    correlationId: payload.correlationId,
    ipAddress: payload.ipAddress ?? null,
    userAgent: payload.userAgent ?? null,
    metadata: payload.metadata ?? {}
  });
}

export async function startSignupVerification(
  input: SignupStartInput,
  context: { userAgent?: string | null; ipAddress?: string | null; requestId?: string | null; }
): Promise<SignupStartResponse> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedUsername = normalizeUsername(input.username);
  const normalizedFullName = normalizeFullName(input.fullName);
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);

  await assertSignupIdentityAvailability(normalizedEmail, normalizedUsername, normalizedPhoneNumber);
  await assertSignupVerificationRequestRateLimit(normalizedPhoneNumber, context.ipAddress ?? null);

  const passwordHash = await hashPassword(input.password);

  const verificationSession = await db.transaction(async (tx) => {
    const session = await createSignupVerificationSession(tx, {
      phoneNumber: normalizedPhoneNumber,
      email: normalizedEmail,
      username: normalizedUsername,
      fullName: normalizedFullName,
      passwordHash,
      marketingOptIn: input.marketingOptIn,
      expiresAt: toSignupSessionExpiresAt(),
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null
    });

    if (!session) {
      throw badRequest('Unable to create verification session');
    }

    await logSignupAuditEvent(tx, 'signup_started', {
      correlationId: context.requestId ?? session.id,
      phoneNumber: session.phoneNumber,
      email: session.email,
      username: session.username,
      entityId: session.id,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      metadata: {
        expiresAt: session.expiresAt.toISOString()
      }
    });

    return session;
  });

  try {
    let twilioResponseSid = 'simulated_sid_' + randomUUID();
    let twilioResponseStatus = 'pending';

    if (!env.AUTH_BYPASS_OTP_VERIFICATION) {
      const twilioResponse = await twilioService.sendOtp(
        verificationSession.phoneNumber,
        'signup',
        { ipAddress: context.ipAddress, userAgent: context.userAgent }
      );
      twilioResponseSid = twilioResponse.sid;
      twilioResponseStatus = twilioResponse.status;
    }

    await updateSignupVerificationSessionVerificationSid(db, verificationSession.id, twilioResponseSid);

    await logSignupAuditEvent(db, 'otp_sent', {
      correlationId: context.requestId ?? verificationSession.id,
      phoneNumber: verificationSession.phoneNumber,
      email: verificationSession.email,
      username: verificationSession.username,
      entityId: verificationSession.id,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      metadata: {
        twilioStatus: twilioResponseStatus,
        bypassed: env.AUTH_BYPASS_OTP_VERIFICATION
      }
    });
  } catch (error) {
    await markSignupVerificationSessionCancelled(db, verificationSession.id);
    throw error;
  }

  return {
    verificationSessionId: verificationSession.id
  };
}

export async function resendSignupVerification(
  input: SignupResendInput,
  context: { userAgent?: string | null; ipAddress?: string | null; requestId?: string | null; }
) {
  const session = await findSignupVerificationSessionById(db, input.verificationSessionId);

  if (!session) {
    throw verificationSessionNotFound();
  }

  if (session.status === 'verified') {
    throw verificationSessionNotFound();
  }

  if (session.status === 'cancelled') {
    throw verificationSessionNotFound();
  }

  if (session.status === 'expired' || session.expiresAt.getTime() <= Date.now()) {
    await markSignupVerificationSessionExpired(db, session.id);
    throw otpExpired();
  }

  await assertSignupVerificationRequestRateLimit(session.phoneNumber, context.ipAddress ?? session.ipAddress ?? null);

  try {
    let twilioResponseSid = 'simulated_sid_' + randomUUID();
    let twilioResponseStatus = 'pending';

    if (!env.AUTH_BYPASS_OTP_VERIFICATION) {
      const twilioResponse = await twilioService.sendOtp(
        session.phoneNumber,
        'signup',
        { ipAddress: context.ipAddress ?? session.ipAddress, userAgent: context.userAgent ?? session.userAgent }
      );
      twilioResponseSid = twilioResponse.sid;
      twilioResponseStatus = twilioResponse.status;
    }

    const updatedSession = await updateSignupVerificationSessionVerificationSid(db, session.id, twilioResponseSid);
    if (!updatedSession) {
      throw badRequest('Unable to update verification session');
    }

    await logSignupAuditEvent(db, 'otp_resend', {
      correlationId: context.requestId ?? session.id,
      phoneNumber: session.phoneNumber,
      email: session.email,
      username: session.username,
      entityId: session.id,
      ipAddress: context.ipAddress ?? session.ipAddress ?? null,
      userAgent: context.userAgent ?? session.userAgent ?? null,
      metadata: {
        twilioStatus: twilioResponseStatus,
        bypassed: env.AUTH_BYPASS_OTP_VERIFICATION
      }
    });

    return { success: true };
  } catch (error) {
    throw error;
  }
}

export async function verifySignupVerification(
  input: SignupVerifyInput,
  context: { userAgent?: string | null; ipAddress?: string | null; requestId?: string | null; }
): Promise<AuthResult> {
  const session = await findSignupVerificationSessionById(db, input.verificationSessionId);

  if (!session) {
    throw verificationSessionNotFound();
  }

  if (isSignupVerificationComplete(session)) {
    throw verificationSessionNotFound();
  }

  if (session.status === 'cancelled') {
    throw verificationSessionNotFound();
  }

  if (session.status === 'expired' || session.expiresAt.getTime() <= Date.now()) {
    await markSignupVerificationSessionExpired(db, session.id);
    throw otpExpired();
  }

  const claimedAttempt = await claimSignupVerificationAttempt(db, session.id, 5);
  if (!claimedAttempt) {
    if (session.attemptCount >= 5) {
      throw otpAttemptsExceeded();
    }

    throw verificationSessionNotFound();
  }

  let twilioResult;

  if (env.AUTH_BYPASS_OTP_VERIFICATION) {
    twilioResult = {
      status: 'approved',
      valid: true,
      sid: session.verificationSid ?? session.id
    };
  } else {
    try {
      const isValid = await twilioService.verifyOtp(
        session.phoneNumber,
        input.code.trim(),
        'signup',
        { ipAddress: context.ipAddress ?? session.ipAddress, userAgent: context.userAgent ?? session.userAgent }
      );
      twilioResult = {
        status: isValid ? 'approved' : 'pending',
        valid: isValid,
        sid: session.verificationSid ?? session.id
      };
    } catch (error) {
      await logSignupAuditEvent(db, 'otp_failed', {
        correlationId: context.requestId ?? session.id,
        phoneNumber: session.phoneNumber,
        email: session.email,
        username: session.username,
        entityId: session.id,
        ipAddress: context.ipAddress ?? session.ipAddress ?? null,
        userAgent: context.userAgent ?? session.userAgent ?? null,
        metadata: {
          reason: error instanceof Error ? error.message : 'Twilio verification failed'
        }
      });

      throw error;
    }
  }

  if (twilioResult.status !== 'approved' && twilioResult.valid !== true) {
    await logSignupAuditEvent(db, 'otp_failed', {
      correlationId: context.requestId ?? session.id,
      phoneNumber: session.phoneNumber,
      email: session.email,
      username: session.username,
      entityId: session.id,
      ipAddress: context.ipAddress ?? session.ipAddress ?? null,
      userAgent: context.userAgent ?? session.userAgent ?? null,
      metadata: {
        twilioStatus: twilioResult.status
      }
    });

    throw otpInvalid();
  }

  const verifiedSession = await markSignupVerificationSessionVerified(db, session.id, new Date());
  if (!verifiedSession) {
    throw verificationSessionNotFound();
  }

  await logSignupAuditEvent(db, 'otp_verified', {
    correlationId: context.requestId ?? session.id,
    phoneNumber: session.phoneNumber,
    email: session.email,
    username: session.username,
    entityId: session.id,
    ipAddress: context.ipAddress ?? session.ipAddress ?? null,
    userAgent: context.userAgent ?? session.userAgent ?? null,
    metadata: {
      twilioStatus: twilioResult.status,
      attemptCount: claimedAttempt.attemptCount
    }
  });

  const result = await db.transaction(async (tx) => {
    const user = await createUserRecord(tx, {
      username: verifiedSession.username,
      full_name: verifiedSession.fullName,
      phoneNumber: verifiedSession.phoneNumber,
      phoneVerifiedAt: verifiedSession.verifiedAt ?? new Date(),
      marketingOptIn: verifiedSession.marketingOptIn ?? false
    });

    if (!user) {
      throw badRequest('Unable to create user');
    }

    const authAccount = await createAuthAccount(tx, {
      userId: user.id,
      provider: 'email',
      email: verifiedSession.email,
      passwordHash: verifiedSession.passwordHash,
      providerAccountId: verifiedSession.email,
      isPrimary: true,
      isVerified: true
    });

    if (!authAccount) {
      throw badRequest('Unable to create auth account');
    }

    const sessionId = randomUUID();
    const tokens = createTokenPair(
      {
        sub: user.id,
        sid: sessionId,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt
      },
      {
        accessSecret: env.ACCESS_TOKEN_SECRET,
        refreshSecret: env.REFRESH_TOKEN_SECRET,
        accessExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
        refreshExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN
      }
    );

    const refreshTokenHash = await hashPassword(tokens.refreshToken);
    const authSession = await createSessionRecord(tx, {
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN)),
      userAgent: context.userAgent ?? verifiedSession.userAgent,
      ipAddress: context.ipAddress ?? verifiedSession.ipAddress
    });

    if (!authSession) {
      throw badRequest('Unable to create session');
    }

    await createAuditLogRecord(tx, {
      eventType: 'signup_completed',
      actorType: 'user',
      actorUserId: user.id,
      entityType: 'signup_verification_session',
      entityId: verifiedSession.id,
      phoneNumber: verifiedSession.phoneNumber,
      email: verifiedSession.email,
      username: verifiedSession.username,
      correlationId: context.requestId ?? verifiedSession.id,
      ipAddress: context.ipAddress ?? verifiedSession.ipAddress,
      userAgent: context.userAgent ?? verifiedSession.userAgent,
      metadata: {
        sessionId: authSession.id
      }
    });

    return {
      user: toPublicUser(user),
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
    };
  });

  if (result?.user) {
    try {
      await marketingHooks.onUserRegistered(
        {
          id: result.user.id,
          email: verifiedSession.email,
          fullName: result.user.fullName,
          marketingOptIn: result.user.marketingOptIn ?? false
        },
        { tenantId: null }
      );
    } catch (hookErr: any) {
      logger.error('Error executing marketing onUserRegistered hook:', { error: hookErr.message });
    }
  }

  return result;
}

export async function login(input: LoginInput, context: { userAgent?: string | null; ipAddress?: string | null; }): Promise<AuthResult> {
  const identifier = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const authAccount = await findAuthAccountByProviderAndAccountId(tx, 'email', identifier);

    if (!authAccount || !authAccount.passwordHash) {
      throw unauthorized('Invalid credentials');
    }

    const isValid = await verifyPassword(authAccount.passwordHash, input.password);
    if (!isValid) {
      throw unauthorized('Invalid credentials');
    }

    const user = await findUserById(tx, authAccount.userId);
    if (!user) {
      throw unauthorized('Invalid credentials');
    }

    const sessionId = randomUUID();
    const tokens = createTokenPair(
      {
        sub: user.id,
        sid: sessionId,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt
      },
      {
        accessSecret: env.ACCESS_TOKEN_SECRET,
        refreshSecret: env.REFRESH_TOKEN_SECRET,
        accessExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
        refreshExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN
      }
    );

    const refreshTokenHash = await hashPassword(tokens.refreshToken);
    const session = await createSessionRecord(tx, {
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN)),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress
    });

    if (!session) {
      throw badRequest('Unable to create session');
    }

    await updateAuthAccountLastLoginAt(tx, authAccount.id, new Date());

    const loginResult = {
      user: toPublicUser(user),
      session: {
        id: session.id,
        expiresAt: session.expiresAt
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: {
          accessToken: env.ACCESS_TOKEN_EXPIRES_IN,
          refreshToken: env.REFRESH_TOKEN_EXPIRES_IN
        }
      }
    };

    // Trigger user login hook asynchronously/safely after login success
    try {
      await marketingHooks.onUserLogin(
        { id: user.id, email: identifier },
        { tenantId: null }
      );
    } catch (hookErr: any) {
      logger.error('Error executing marketing onUserLogin hook:', { error: hookErr.message });
    }

    return loginResult;
  });
}

/**
 * Public "Become an Organizer" registration.
 *
 * Creates a user + email/password auth account and a *pending* tenant workspace
 * (owner membership), then issues a token pair so the new organizer is signed in
 * immediately. They can log in, but the dashboard gates them out until a
 * superadmin approves the tenant (approvalStatus: pending → approved/rejected).
 *
 * Unlike the consumer phone-OTP signup, this trusts the email at registration
 * (the account is marked verified) — the human gate is the superadmin approval,
 * not an OTP.
 */
export async function registerOrganizer(
  input: OrganizerRegisterInput,
  context: { userAgent?: string | null; ipAddress?: string | null; }
): Promise<AuthResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedFullName = normalizeFullName(input.fullName);
  const organizationName = input.organizationName.trim();
  // phoneNumber is already normalized to E.164 by the request schema; normalize
  // again defensively.
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);

  // The email login must be unique. This is the ONLY hard duplicate check for
  // organizer registration — we deliberately do NOT enforce phone uniqueness
  // here (see below), so someone who already uses the consumer app with this
  // phone can still register as an organizer.
  const existingAccount = await findAuthAccountByProviderAndAccountId(db, 'email', normalizedEmail);
  if (existingAccount) {
    throw conflict('An account with this email already exists. Please sign in instead.');
  }

  const username = await generateAvailableUsername(normalizedEmail);
  const passwordHash = await hashPassword(input.password);

  // Everything — user, auth account, tenant workspace and owner membership — is
  // created in a SINGLE transaction. If any step fails, nothing persists, so the
  // organizer can simply resubmit the form (no orphaned half-accounts that would
  // otherwise make every retry fail with "email already exists").
  const { user } = await db.transaction(async (tx) => {
    const createdUser = await createUserRecord(tx, {
      username,
      full_name: normalizedFullName,
      // phoneNumber is intentionally left null. Organizers authenticate by
      // email/password, and users.phone_number has a global unique index — a
      // consumer already using this phone would otherwise block registration.
      // The organizer's phone is captured on the tenant record instead.
      email: normalizedEmail,
      marketingOptIn: false
    });
    if (!createdUser) {
      throw badRequest('Unable to create user');
    }

    const authAccount = await createAuthAccount(tx, {
      userId: createdUser.id,
      provider: 'email',
      email: normalizedEmail,
      passwordHash,
      providerAccountId: normalizedEmail,
      isPrimary: true,
      isVerified: true
    });
    if (!authAccount) {
      throw badRequest('Unable to create auth account');
    }

    // Pending tenant workspace with the organizer as owner. Enters the superadmin
    // review queue. The slug carries a random suffix so it never collides.
    const createdTenant = await createTenantRecord(tx, {
      name: organizationName,
      slug: createUniqueSlug(organizationName),
      email: normalizedEmail,
      phone: normalizedPhoneNumber,
      createdByUserId: createdUser.id,
      approvalStatus: 'pending'
    });
    if (!createdTenant) {
      throw badRequest('Unable to create workspace');
    }

    const membership = await createTenantMemberRecord(tx, {
      tenantId: createdTenant.id,
      userId: createdUser.id,
      role: 'owner',
      invitedByUserId: createdUser.id
    });
    if (!membership) {
      throw badRequest('Unable to create workspace membership');
    }

    return { user: createdUser, tenant: createdTenant };
  });

  // Issue a session so the client lands straight on the waiting-for-approval
  // screen (same shape as login/verify).
  const sessionId = randomUUID();
  const tokens = createTokenPair(
    {
      sub: user.id,
      sid: sessionId,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt
    },
    {
      accessSecret: env.ACCESS_TOKEN_SECRET,
      refreshSecret: env.REFRESH_TOKEN_SECRET,
      accessExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
      refreshExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN
    }
  );

  const refreshTokenHash = await hashPassword(tokens.refreshToken);
  const session = await createSessionRecord(db, {
    id: sessionId,
    userId: user.id,
    refreshTokenHash,
    expiresAt: new Date(Date.now() + parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN)),
    userAgent: context.userAgent ?? null,
    ipAddress: context.ipAddress ?? null
  });

  if (!session) {
    throw badRequest('Unable to create session');
  }

  try {
    await marketingHooks.onUserRegistered(
      {
        id: user.id,
        email: normalizedEmail,
        fullName: user.fullName,
        marketingOptIn: user.marketingOptIn ?? false
      },
      { tenantId: null }
    );
  } catch (hookErr: any) {
    logger.error('Error executing marketing onUserRegistered hook:', { error: hookErr.message });
  }

  return {
    user: toPublicUser(user),
    session: {
      id: session.id,
      expiresAt: session.expiresAt
    },
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: {
        accessToken: env.ACCESS_TOKEN_EXPIRES_IN,
        refreshToken: env.REFRESH_TOKEN_EXPIRES_IN
      }
    }
  };
}

/** Derive a unique username from the email local-part (append a suffix on clash). */
async function generateAvailableUsername(email: string): Promise<string> {
  const base = (email.split('@')[0] ?? 'organizer').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'organizer';
  const candidate = base.length < 3 ? `${base}_org` : base;

  if (!(await findUserByUsername(db, candidate))) {
    return candidate;
  }

  for (let i = 0; i < 5; i += 1) {
    const suffix = randomUUID().slice(0, 6);
    const next = `${candidate.slice(0, 43)}_${suffix}`;
    if (!(await findUserByUsername(db, next))) {
      return next;
    }
  }

  // Extremely unlikely — fall back to a fully random handle.
  return `organizer_${randomUUID().slice(0, 12)}`;
}

export async function refresh(input: RefreshInput): Promise<AuthResult> {
  const claims = decodeRefreshToken(input.refreshToken);
  if (!claims.sid) {
    throw unauthorized('Invalid refresh token');
  }

  const session = await findSessionById(db, claims.sid);
  if (!session) {
    throw unauthorized('Session not found');
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Session expired');
  }

  const isRefreshTokenValid = await verifyPassword(session.refreshTokenHash, input.refreshToken);
  if (!isRefreshTokenValid) {
    throw unauthorized('Invalid refresh token');
  }

  const user = await findUserById(db, session.userId);
  if (!user) {
    throw unauthorized('User not found');
  }

  const tokens = createTokenPair(
    {
      sub: user.id,
      sid: session.id,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt
    },
    {
      accessSecret: env.ACCESS_TOKEN_SECRET,
      refreshSecret: env.REFRESH_TOKEN_SECRET,
      accessExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
      refreshExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN
    }
  );

  const nextHash = await hashPassword(tokens.refreshToken);
  const updatedSession = await updateSessionRefreshTokenHash(
    db,
    session.id,
    nextHash,
    new Date(Date.now() + parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN))
  );

  if (!updatedSession) {
    throw badRequest('Unable to rotate session');
  }

  return {
    user: toPublicUser(user),
    session: {
      id: updatedSession.id,
      expiresAt: updatedSession.expiresAt
    },
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: {
        accessToken: env.ACCESS_TOKEN_EXPIRES_IN,
        refreshToken: env.REFRESH_TOKEN_EXPIRES_IN
      }
    }
  };
}

export async function logout(input: LogoutInput) {
  const claims = decodeRefreshToken(input.refreshToken);

  if (!claims.sid) {
    throw unauthorized('Invalid refresh token');
  }

  const session = await findSessionById(db, claims.sid);
  if (!session) {
    return { success: true };
  }

  const isValid = await verifyPassword(session.refreshTokenHash, input.refreshToken);
  if (!isValid) {
    throw unauthorized('Invalid refresh token');
  }

  await deleteSessionById(db, session.id);
  return { success: true };
}

export async function me(userId: string): Promise<AuthMeResponse> {
  const user = await findUserById(db, userId);
  if (!user) {
    throw unauthorized('Unauthorized');
  }

  const memberships = await findMembershipsForUser(db, userId);
  const authAccounts = await findAuthAccountsByUserId(db, userId);

  return {
    user: toPublicUser(user),
    authAccounts: authAccounts.map(({ passwordHash: _passwordHash, ...account }) => account),
    tenantMemberships: memberships
  };
}

function parseDurationToMs(value: string | number) {
  if (typeof value === 'number') {
    return value * 1000;
  }

  const match = /^([0-9]+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const units: Record<typeof unit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * units[unit];
}