export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_REQUEST'
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'OTP_EXPIRED'
  | 'OTP_INVALID'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'PHONE_NOT_SUPPORTED'
  | 'RATE_LIMITED'
  | 'TWILIO_UNAVAILABLE'
  | 'VERIFICATION_SESSION_NOT_FOUND'
  | 'INTERNAL_SERVER_ERROR'
  | 'TICKET_ALREADY_CHECKED_IN'
  | 'INVALID_TICKET_STATUS'
  | 'INVALID_QR_TOKEN'
  | 'TICKET_INVALIDATED'
  | 'EMAIL_PROVIDER_ERROR'
  | 'EMAIL_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_ERROR'
  | 'AI_PROVIDER_UNAVAILABLE';

export interface AppErrorOptions {
  message: string;
  code: AppErrorCode;
  statusCode: number;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function badRequest(message: string, details?: unknown) {
  return new AppError({ message, code: 'BAD_REQUEST', statusCode: 400, details });
}

export function conflict(message = 'Conflict', details?: unknown) {
  return new AppError({ message, code: 'CONFLICT', statusCode: 409, details });
}

export function staleRequest(message = 'Record was updated by another user', details?: unknown) {
  return new AppError({ message, code: 'STALE_REQUEST', statusCode: 409, details });
}

export function unauthorized(message = 'Unauthorized', details?: unknown) {
  return new AppError({ message, code: 'UNAUTHORIZED', statusCode: 401, details });
}

export function forbidden(message = 'Forbidden', details?: unknown) {
  return new AppError({ message, code: 'FORBIDDEN', statusCode: 403, details });
}

export function notFound(message = 'Not found', details?: unknown) {
  return new AppError({ message, code: 'NOT_FOUND', statusCode: 404, details });
}

export function validationError(message = 'Validation failed', details?: unknown) {
  return new AppError({ message, code: 'VALIDATION_ERROR', statusCode: 400, details });
}

export function ticketAlreadyCheckedIn(details?: unknown) {
  return new AppError({ message: 'Ticket already checked in', code: 'TICKET_ALREADY_CHECKED_IN', statusCode: 409, details });
}

export function invalidTicketStatus(message = 'Invalid ticket status', details?: unknown) {
  return new AppError({ message, code: 'INVALID_TICKET_STATUS', statusCode: 409, details });
}

export function invalidQrToken(details?: unknown) {
  return new AppError({ message: 'Invalid QR token', code: 'INVALID_QR_TOKEN', statusCode: 404, details });
}

export function ticketInvalidated(details?: unknown) {
  return new AppError({ message: 'Ticket invalidated', code: 'TICKET_INVALIDATED', statusCode: 409, details });
}

export function otpExpired(details?: unknown) {
  return new AppError({ message: 'OTP expired', code: 'OTP_EXPIRED', statusCode: 400, details });
}

export function otpInvalid(details?: unknown) {
  return new AppError({ message: 'OTP invalid', code: 'OTP_INVALID', statusCode: 400, details });
}

export function otpAttemptsExceeded(details?: unknown) {
  return new AppError({ message: 'OTP attempts exceeded', code: 'OTP_ATTEMPTS_EXCEEDED', statusCode: 429, details });
}

export function phoneNotSupported(details?: unknown) {
  return new AppError({ message: 'Phone number not supported', code: 'PHONE_NOT_SUPPORTED', statusCode: 400, details });
}

export function rateLimited(details?: unknown) {
  return new AppError({ message: 'Rate limited', code: 'RATE_LIMITED', statusCode: 429, details });
}

export function twilioUnavailable(details?: unknown) {
  return new AppError({ message: 'Twilio Verify unavailable', code: 'TWILIO_UNAVAILABLE', statusCode: 503, details });
}

export function verificationSessionNotFound(details?: unknown) {
  return new AppError({ message: 'Verification session not found', code: 'VERIFICATION_SESSION_NOT_FOUND', statusCode: 404, details });
}

export function emailProviderError(message = 'Email provider error', details?: unknown) {
  return new AppError({ message, code: 'EMAIL_PROVIDER_ERROR', statusCode: 502, details });
}

export function emailProviderUnavailable(message = 'Email provider unavailable', details?: unknown) {
  return new AppError({ message, code: 'EMAIL_PROVIDER_UNAVAILABLE', statusCode: 503, details });
}

export function emailTemplateRenderError(details?: unknown) {
  return new AppError({ message: 'Email template render error', code: 'BAD_REQUEST', statusCode: 400, details });
}

export function aiProviderError(message = 'AI assistant error', details?: unknown) {
  return new AppError({ message, code: 'AI_PROVIDER_ERROR', statusCode: 502, details });
}

export function aiProviderUnavailable(message = 'AI assistant is temporarily unavailable', details?: unknown) {
  return new AppError({ message, code: 'AI_PROVIDER_UNAVAILABLE', statusCode: 503, details });
}
