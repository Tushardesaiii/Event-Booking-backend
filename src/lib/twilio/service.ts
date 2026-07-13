import { env } from '../../config/env.js';
import { twilioUnavailable } from '../errors.js';
import { normalizeTwilioError } from './errors.js';

const TWILIO_VERIFY_BASE_URL = 'https://verify.twilio.com/v2';

export interface TwilioVerificationResult {
  sid: string;
  status: string;
  to: string;
  channel: string;
}

export interface TwilioVerificationCheckResult {
  sid: string;
  status: 'approved' | 'pending' | 'canceled' | 'max_attempts_reached' | string;
  to?: string;
  valid?: boolean;
}

interface VerifyPhoneInput {
  phoneNumber: string;
}

interface VerifyCodeInput {
  phoneNumber: string;
  verificationSid: string;
  code: string;
}

function buildAuthHeader() {
  const token = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  return `Basic ${token}`;
}

async function twilioRequest<T>(path: string, options: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${TWILIO_VERIFY_BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: buildAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(options.headers ?? {})
      }
    });
  } catch (error) {
    throw twilioUnavailable({ message: 'Unable to reach Twilio Verify', cause: error instanceof Error ? error.message : String(error) });
  }

  const text = await response.text();
  let parsed: any;

  try {
    parsed = text.trim().length > 0 ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    throw normalizeTwilioError(parsed);
  }

  return parsed;
}

export const twilioVerifyService = {
  async sendVerification(input: VerifyPhoneInput): Promise<TwilioVerificationResult> {
    const body = new URLSearchParams({
      To: input.phoneNumber,
      Channel: 'sms'
    });

    return twilioRequest<TwilioVerificationResult>(`/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`, {
      method: 'POST',
      body
    });
  },

  async verifyCode(input: VerifyCodeInput): Promise<TwilioVerificationCheckResult> {
    const body = new URLSearchParams({
      To: input.phoneNumber,
      Code: input.code,
      VerificationSid: input.verificationSid
    });

    return twilioRequest<TwilioVerificationCheckResult>(`/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, {
      method: 'POST',
      body
    });
  }
};