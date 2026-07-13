import { otpAttemptsExceeded, otpExpired, otpInvalid, phoneNotSupported, rateLimited, twilioUnavailable, verificationSessionNotFound } from '../errors.js';

export function normalizeTwilioError(error: unknown) {
  const twilioError = error as { status?: number; code?: number; message?: string; details?: unknown } | undefined;
  const statusCode = twilioError?.status ?? 500;
  const code = twilioError?.code;
  const message = twilioError?.message ?? 'Twilio Verify request failed';

  if (code === 20404) {
    return verificationSessionNotFound({ code, message });
  }

  if (code === 60202) {
    return otpExpired({ code, message });
  }

  if (code === 60200 || code === 60201) {
    return phoneNotSupported({ code, message });
  }

  if (code === 60203 || code === 60204) {
    return otpAttemptsExceeded({ code, message });
  }

  if (statusCode === 429) {
    return rateLimited({ code, message });
  }

  if (statusCode === 400 || statusCode === 404) {
    return otpInvalid({ code, message });
  }

  return twilioUnavailable({ code, message });
}