import type { Context } from 'hono';

import { errorResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import type {
  LoginSchema,
  LogoutSchema,
  OrganizerRegisterSchema,
  RefreshSchema,
  SignupResendSchema,
  SignupStartSchema,
  SignupVerifySchema,
  SendEmailVerificationSchema,
  VerifyEmailSchema,
  SendOtpSchema,
  VerifyOtpSchema
} from './validation.js';
import { login, logout, me, refresh, registerOrganizer, resendSignupVerification, startSignupVerification, verifySignupVerification } from './service.js';
import { emailVerificationService } from './email-verification.service.js';
import { otpService } from './otp.service.js';
import { checkIdempotency, saveIdempotency } from '../../lib/idempotency.js';

function getClientMetadata(c: Context<AppEnv>) {
  return {
    userAgent: c.req.header('user-agent'),
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? null,
    requestId: c.get('requestId') ?? c.req.header('x-request-id') ?? null,
    correlationId: c.get('correlationId') ?? c.req.header('x-correlation-id') ?? null
  };
}

export const authController = {
  async signupStart(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as SignupStartSchema;
    const result = await startSignupVerification(input, getClientMetadata(c));
    return successResponse(c, result, 'Verification code sent', 201);
  },
  async signupVerify(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as SignupVerifySchema;
    const result = await verifySignupVerification(input, getClientMetadata(c));
    return successResponse(c, result, 'Signup completed', 201);
  },
  async signupResend(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as SignupResendSchema;
    const result = await resendSignupVerification(input, getClientMetadata(c));
    return successResponse(c, result, 'Verification code sent');
  },
  async login(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as LoginSchema;
    const result = await login(input, getClientMetadata(c));
    return successResponse(c, result, 'Login successful');
  },
  async organizerRegister(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as OrganizerRegisterSchema;
    const result = await registerOrganizer(input, getClientMetadata(c));
    return successResponse(c, result, 'Organizer registration received', 201);
  },
  async refresh(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as RefreshSchema;
    const result = await refresh(input);
    return successResponse(c, result, 'Token refreshed');
  },
  async logout(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as LogoutSchema;
    const result = await logout(input);
    return successResponse(c, result, 'Logout successful');
  },
  async me(c: Context<AppEnv>) {
    const user = c.get('user');
    if (!user) {
      return errorResponse(c, { message: 'Unauthorized', code: 'UNAUTHORIZED', status: 401 });
    }

    const result = await me(user.id);
    return successResponse(c, result, 'Profile loaded');
  },

  async sendEmailVerification(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as SendEmailVerificationSchema;
    const meta = getClientMetadata(c);
    const tenantId = c.get('tenant')?.id ?? null;
    const currentUser = c.get('user');
    const actorUserId = currentUser?.id ?? null;

    const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
    if (idempotencyKey) {
      const cached = await checkIdempotency(idempotencyKey, 'send-email-verification');
      if (cached) {
        return successResponse(c, cached.data, cached.message, cached.status);
      }
    }

    const result = await emailVerificationService.sendVerificationEmail({
      email: input.email,
      tenantId,
      actorUserId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      requestId: meta.requestId
    });

    const responsePayload = { data: result, message: 'Verification email sent', status: 200 };
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 'send-email-verification', input.email, null, responsePayload, actorUserId);
    }

    return successResponse(c, result, 'Verification email sent');
  },

  async verifyEmail(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as VerifyEmailSchema;
    const meta = getClientMetadata(c);
    const tenantId = c.get('tenant')?.id ?? null;
    const currentUser = c.get('user');
    const actorUserId = currentUser?.id ?? null;

    const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
    if (idempotencyKey) {
      const cached = await checkIdempotency(idempotencyKey, 'verify-email');
      if (cached) {
        return successResponse(c, cached.data, cached.message, cached.status);
      }
    }

    const result = await emailVerificationService.verifyEmail({
      token: input.token,
      tenantId,
      actorUserId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      requestId: meta.requestId
    });

    const responsePayload = { data: result, message: 'Email verified successfully', status: 200 };
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 'verify-email', null, null, responsePayload, actorUserId);
    }

    return successResponse(c, result, 'Email verified successfully');
  },

  async sendOtp(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as SendOtpSchema;
    const meta = getClientMetadata(c);
    const tenantId = c.get('tenant')?.id ?? null;
    const currentUser = c.get('user');
    const actorUserId = currentUser?.id ?? null;

    const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
    if (idempotencyKey) {
      const cached = await checkIdempotency(idempotencyKey, 'send-otp');
      if (cached) {
        return successResponse(c, cached.data, cached.message, cached.status);
      }
    }

    const result = await otpService.sendOtp({
      phoneNumber: input.phoneNumber,
      purpose: input.purpose,
      tenantId,
      actorUserId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      requestId: meta.requestId
    });

    const responsePayload = { data: result, message: 'OTP sent successfully', status: 200 };
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 'send-otp', null, input.phoneNumber, responsePayload, actorUserId);
    }

    return successResponse(c, result, 'OTP sent successfully');
  },

  async verifyOtp(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as VerifyOtpSchema;
    const meta = getClientMetadata(c);
    const tenantId = c.get('tenant')?.id ?? null;
    const currentUser = c.get('user');
    const actorUserId = currentUser?.id ?? null;

    const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
    if (idempotencyKey) {
      const cached = await checkIdempotency(idempotencyKey, 'verify-otp');
      if (cached) {
        return successResponse(c, cached.data, cached.message, cached.status);
      }
    }

    const result = await otpService.verifyOtp({
      phoneNumber: input.phoneNumber,
      purpose: input.purpose,
      code: input.code,
      tenantId,
      actorUserId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      requestId: meta.requestId
    });

    const responsePayload = { data: result, message: 'OTP verified successfully', status: 200 };
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 'verify-otp', null, input.phoneNumber, responsePayload, actorUserId);
    }

    return successResponse(c, result, 'OTP verified successfully');
  }
};