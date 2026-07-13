import { env } from '../config/env.js';
import { cacheService } from './cache.js';
import { logger } from './logger.js';
import { twilioUnavailable, otpInvalid, otpExpired, otpAttemptsExceeded, phoneNotSupported, rateLimited, badRequest } from './errors.js';
import { db } from '../db/client.js';
import { insertVerificationEvent } from '../modules/notifications/repository.js';
import { incrementMetric } from './metrics.js';

const TWILIO_VERIFY_BASE_URL = 'https://verify.twilio.com/v2';
const TWILIO_API_BASE_URL = 'https://api.twilio.com/2010-04-01';

export function maskPhoneNumber(phone: string): string {
  if (!phone) return '';
  const clean = phone.trim();
  if (clean.length <= 7) {
    return '*****' + clean.slice(-2);
  }
  return clean.slice(0, 3) + '*****' + clean.slice(-4);
}

function buildAuthHeader(): string {
  const token = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  return `Basic ${token}`;
}

export interface TwilioVerifyResponse {
  sid: string;
  status: string;
  to: string;
  channel: string;
  valid?: boolean;
}

export class TwilioService {
  private static instance: TwilioService | null = null;
  private isValidConnection: boolean | null = null;

  private constructor() {}

  public static getInstance(): TwilioService {
    if (!TwilioService.instance) {
      TwilioService.instance = new TwilioService();
    }
    return TwilioService.instance;
  }

  /**
   * Validate Twilio credentials connection
   */
  public async validateConnection(): Promise<boolean> {
    if (this.isValidConnection !== null) {
      return this.isValidConnection;
    }

    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      this.isValidConnection = false;
      return false;
    }

    try {
      const response = await fetch(`${TWILIO_API_BASE_URL}/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, {
        method: 'GET',
        headers: {
          Authorization: buildAuthHeader(),
        },
      });

      this.isValidConnection = response.ok;
      if (response.ok) {
        logger.info('[TwilioService] Connection validated successfully');
      } else {
        logger.error('[TwilioService] Connection validation failed', { status: response.status });
      }
      return this.isValidConnection;
    } catch (err: any) {
      logger.error('[TwilioService] Failed to validate connection', { error: err.message });
      this.isValidConnection = false;
      return false;
    }
  }

  private normalizeTwilioError(twilioError: any) {
    const statusCode = twilioError?.status ?? 500;
    const code = twilioError?.code;
    const message = twilioError?.message ?? 'Twilio Verify request failed';

    logger.warn('[TwilioService] Normalized Twilio Error', { statusCode, code, message });

    if (code === 20404) {
      return twilioUnavailable({ code, message: 'Verification session not found' });
    }
    if (code === 60202) {
      incrementMetric('otp_expired_total');
      return otpExpired({ code, message });
    }
    if (code === 60200 || code === 60201) {
      incrementMetric('twilio_delivery_failures_total');
      return phoneNotSupported({ code, message });
    }
    if (code === 60203 || code === 60204) {
      incrementMetric('otp_failed_total');
      return otpAttemptsExceeded({ code, message });
    }
    if (statusCode === 429) {
      return rateLimited({ code, message });
    }
    if (statusCode === 400 || statusCode === 404) {
      incrementMetric('otp_failed_total');
      return otpInvalid({ code, message });
    }

    return twilioUnavailable({ code, message });
  }

  private async twilioRequest<T>(path: string, options: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${TWILIO_VERIFY_BASE_URL}${path}`, {
        ...options,
        headers: {
          Authorization: buildAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(options.headers ?? {}),
        },
      });
    } catch (error: any) {
      throw twilioUnavailable({ message: 'Unable to reach Twilio Verify API', cause: error.message });
    }

    const text = await response.text();
    let parsed: any;

    try {
      parsed = text.trim().length > 0 ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw this.normalizeTwilioError(parsed);
    }

    return parsed as T;
  }

  public async sendSms(to: string, message: string): Promise<{ sid: string; status: string }> {
    const cleanTo = to.trim();
    const isMock = cleanTo.startsWith('+1555') || cleanTo.startsWith('555') || env.AUTH_BYPASS_OTP_VERIFICATION;
    
    if (env.NODE_ENV !== 'production' && isMock) {
      logger.info('[TwilioService] Bypassing sendSms in development for test number', { to: maskPhoneNumber(to) });
      incrementMetric('twilio_sms_sent_total');
      return {
        sid: `simulated-twilio-sms-${Date.now()}`,
        status: 'queued',
      };
    }

    const body = new URLSearchParams({
      To: to,
      From: env.TWILIO_PHONE_NUMBER,
      Body: message,
    });

    try {
      const response = await fetch(`${TWILIO_API_BASE_URL}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: buildAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      const text = await response.text();
      let parsed: any = {};
      try {
        parsed = JSON.parse(text);
      } catch {}

      if (!response.ok) {
        incrementMetric('twilio_sms_failed_total');
        throw this.normalizeTwilioError(parsed);
      }

      incrementMetric('twilio_sms_sent_total');
      return {
        sid: parsed.sid,
        status: parsed.status,
      };
    } catch (error: any) {
      incrementMetric('twilio_sms_failed_total');
      logger.error('[TwilioService] Failed to send SMS via API', { error: error.message });
      throw error;
    }
  }

  /**
   * Send OTP via Twilio Verify API
   */
  public async sendOtp(
    phoneNumber: string,
    purpose: string = 'auth',
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
      tenantId?: string | null;
      correlationId?: string | null;
      requestId?: string | null;
    }
  ): Promise<TwilioVerifyResponse> {
    const maskedPhone = maskPhoneNumber(phoneNumber);
    logger.info('[TwilioService] sendOtp requested', { phoneNumber: maskedPhone, purpose });

    // 1. Resend Throttling check (using Redis)
    const throttleKey = `revelis:otp:throttle:${purpose}:${phoneNumber}`;
    if (env.NODE_ENV === 'production') {
      const isThrottled = await cacheService.exists(throttleKey);
      if (isThrottled) {
        logger.warn('[TwilioService] Resend throttled', { phoneNumber: maskedPhone, purpose });
        throw rateLimited('Please wait 60 seconds before requesting another OTP');
      }
    }

    const cleanPhone = phoneNumber.trim();
    const isMock = cleanPhone.startsWith('+1555') || cleanPhone.startsWith('555') || env.AUTH_BYPASS_OTP_VERIFICATION;
    
    if (env.NODE_ENV !== 'production' && isMock) {
      logger.info('[TwilioService] Bypassing sendOtp in development for test number', { phoneNumber: maskedPhone });

      // Audit Log OTP Generation even for mock bypass!
      await insertVerificationEvent(db, {
        actorUserId: null,
        tenantId: context?.tenantId ?? null,
        eventType: 'sent',
        source: 'otp',
        phoneNumber,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        provider: 'twilio_verify',
        providerMessageId: `simulated-verify-sid-${Date.now()}`,
        providerStatus: 'pending',
        correlationId: context?.correlationId ?? null,
        requestId: context?.requestId ?? null,
        metadata: { purpose, isMock: true },
      });

      incrementMetric('otp_generated_total');
      incrementMetric('twilio_sms_sent_total');
      return {
        sid: `simulated-verify-sid-${Date.now()}`,
        status: 'pending',
        to: phoneNumber,
        channel: 'sms',
      };
    }

    try {
      const body = new URLSearchParams({
        To: phoneNumber,
        Channel: 'sms',
      });

      const result = await this.twilioRequest<TwilioVerifyResponse>(
        `/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`,
        {
          method: 'POST',
          body,
        }
      );

      // Set throttling key in Redis (60 seconds)
      if (env.NODE_ENV === 'production') {
        await cacheService.set(throttleKey, 'throttled', 60);
      }

      // Audit Log OTP Generation
      await insertVerificationEvent(db, {
        actorUserId: null,
        tenantId: context?.tenantId ?? null,
        eventType: 'sent',
        source: 'otp',
        phoneNumber,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        provider: 'twilio_verify',
        providerMessageId: result.sid,
        providerStatus: result.status,
        correlationId: context?.correlationId ?? null,
        requestId: context?.requestId ?? null,
        metadata: { purpose },
      });

      incrementMetric('otp_generated_total');
      incrementMetric('twilio_sms_sent_total');

      logger.info('[TwilioService] OTP verification sent successfully', {
        phoneNumber: maskedPhone,
        sid: result.sid,
      });

      return result;
    } catch (error: any) {
      incrementMetric('twilio_sms_failed_total');
      logger.error('[TwilioService] sendOtp failed', { phoneNumber: maskedPhone, error: error.message });
      
      // Audit log failed send
      await insertVerificationEvent(db, {
        actorUserId: null,
        tenantId: context?.tenantId ?? null,
        eventType: 'failure',
        source: 'otp',
        phoneNumber,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        provider: 'twilio_verify',
        providerStatus: 'failed',
        correlationId: context?.correlationId ?? null,
        requestId: context?.requestId ?? null,
        metadata: { error: error.message, purpose },
      });

      throw error;
    }
  }

  /**
   * Verify OTP via Twilio Verify API
   */
  public async verifyOtp(
    phoneNumber: string,
    code: string,
    purpose: string = 'auth',
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
      tenantId?: string | null;
      correlationId?: string | null;
      requestId?: string | null;
    }
  ): Promise<boolean> {
    const maskedPhone = maskPhoneNumber(phoneNumber);
    logger.info('[TwilioService] verifyOtp requested', { phoneNumber: maskedPhone, purpose });

    if (!code || code.trim().length === 0) {
      throw badRequest('Verification code is required');
    }

    const cleanPhone = phoneNumber.trim();
    const isMock = cleanPhone.startsWith('+1555') || cleanPhone.startsWith('555') || env.AUTH_BYPASS_OTP_VERIFICATION;

    if (env.NODE_ENV !== 'production' && isMock) {
      const isApproved = code === '000000' || code === '123456';
      
      // Audit Log OTP outcome for mock bypass!
      await insertVerificationEvent(db, {
        actorUserId: null,
        tenantId: context?.tenantId ?? null,
        eventType: isApproved ? 'verify_success' : 'failure',
        source: 'otp',
        phoneNumber,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        provider: 'twilio_verify',
        providerMessageId: `simulated-verify-sid-${Date.now()}`,
        providerStatus: isApproved ? 'approved' : 'failed',
        correlationId: context?.correlationId ?? null,
        requestId: context?.requestId ?? null,
        metadata: { purpose, outcome: isApproved ? 'approved' : 'failed', isMock: true },
      });

      if (isApproved) {
        const throttleKey = `revelis:otp:throttle:${purpose}:${phoneNumber}`;
        await cacheService.delete(throttleKey);
        incrementMetric('otp_verified_total');
        logger.info('[TwilioService] Simulated OTP verified successfully', { phoneNumber: maskedPhone });
        return true;
      }
      incrementMetric('otp_failed_total');
      logger.warn('[TwilioService] Simulated OTP verification failed', { phoneNumber: maskedPhone });
      throw otpInvalid();
    }

    try {
      const body = new URLSearchParams({
        To: phoneNumber,
        Code: code.trim(),
      });

      const result = await this.twilioRequest<TwilioVerifyResponse>(
        `/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
        {
          method: 'POST',
          body,
        }
      );

      const isApproved = result.status === 'approved' || result.valid === true;

      // Audit Log OTP outcome
      await insertVerificationEvent(db, {
        actorUserId: null,
        tenantId: context?.tenantId ?? null,
        eventType: isApproved ? 'verify_success' : 'failure',
        source: 'otp',
        phoneNumber,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        provider: 'twilio_verify',
        providerMessageId: result.sid,
        providerStatus: result.status,
        correlationId: context?.correlationId ?? null,
        requestId: context?.requestId ?? null,
        metadata: { purpose, outcome: result.status },
      });

      if (isApproved) {
        // Clear resend throttle on success
        const throttleKey = `revelis:otp:throttle:${purpose}:${phoneNumber}`;
        await cacheService.delete(throttleKey);
        
        incrementMetric('otp_verified_total');
        logger.info('[TwilioService] OTP verified successfully', { phoneNumber: maskedPhone });
        return true;
      }

      incrementMetric('otp_failed_total');
      logger.warn('[TwilioService] OTP verification failed (incorrect code)', { phoneNumber: maskedPhone });
      throw otpInvalid();
    } catch (error: any) {
      logger.error('[TwilioService] verifyOtp error occurred', { phoneNumber: maskedPhone, error: error.message });
      throw error;
    }
  }
}

export const twilioService = TwilioService.getInstance();
