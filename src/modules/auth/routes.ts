import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validation.middleware.js';
import { authRateLimit, otpSendRateLimit, otpVerifyRateLimit } from '../../middlewares/rate-limit.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { authController } from './controller.js';
import {
  loginSchema,
  logoutSchema,
  organizerRegisterSchema,
  refreshSchema,
  signupResendSchema,
  signupStartSchema,
  signupVerifySchema,
  sendEmailVerificationSchema,
  verifyEmailSchema,
  sendOtpSchema,
  verifyOtpSchema
} from './validation.js';

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/signup', authRateLimit, validateBody(signupStartSchema), authController.signupStart);
authRoutes.post('/signup/start', authRateLimit, validateBody(signupStartSchema), authController.signupStart);
authRoutes.post('/signup/verify', otpVerifyRateLimit, validateBody(signupVerifySchema), authController.signupVerify);
authRoutes.post('/signup/resend', otpSendRateLimit, validateBody(signupResendSchema), authController.signupResend);
authRoutes.post('/login', authRateLimit, validateBody(loginSchema), authController.login);
authRoutes.post('/organizer/register', authRateLimit, validateBody(organizerRegisterSchema), authController.organizerRegister);
authRoutes.post('/refresh', authRateLimit, validateBody(refreshSchema), authController.refresh);
authRoutes.post('/logout', authRateLimit, validateBody(logoutSchema), authController.logout);
authRoutes.get('/me', authMiddleware, authController.me);

authRoutes.post('/send-email-verification', otpSendRateLimit, validateBody(sendEmailVerificationSchema), authController.sendEmailVerification);
authRoutes.post('/verify-email', otpVerifyRateLimit, validateBody(verifyEmailSchema), authController.verifyEmail);
authRoutes.post('/send-otp', otpSendRateLimit, validateBody(sendOtpSchema), authController.sendOtp);
authRoutes.post('/verify-otp', otpVerifyRateLimit, validateBody(verifyOtpSchema), authController.verifyOtp);
