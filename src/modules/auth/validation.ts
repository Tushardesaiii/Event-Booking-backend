import { z } from 'zod';

import { normalizePhoneNumber } from '../../lib/phone.js';

const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value), {
    message: 'password must include uppercase, lowercase, number, and special character'
  });

const phoneNumberSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .transform((value, ctx) => {
    try {
      return normalizePhoneNumber(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid phone number'
      });

      return z.NEVER;
    }
  });

export const signupStartSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(50),
  email: z.email().trim().toLowerCase(),
  password: passwordSchema,
  phoneNumber: phoneNumberSchema,
  marketingOptIn: z.boolean().optional()
});

export const signupVerifySchema = z.object({
  verificationSessionId: z.string().uuid(),
  code: z.string().trim().min(4).max(12)
});

export const signupResendSchema = z.object({
  verificationSessionId: z.string().uuid()
});

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: passwordSchema
});

/**
 * Public "Become an Organizer" registration. Creates a user + email/password
 * auth account + a *pending* tenant workspace (owner membership). The organizer
 * can log in immediately but is gated out of the dashboard until a superadmin
 * approves them.
 */
export const organizerRegisterSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    organizationName: z.string().trim().min(2).max(120),
    email: z.email().trim().toLowerCase(),
    phoneNumber: phoneNumberSchema,
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  });

export const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1)
});

export type OrganizerRegisterSchema = z.infer<typeof organizerRegisterSchema>;
export type SignupStartSchema = z.infer<typeof signupStartSchema>;
export type SignupVerifySchema = z.infer<typeof signupVerifySchema>;
export type SignupResendSchema = z.infer<typeof signupResendSchema>;
export type LoginSchema = z.infer<typeof loginSchema>;
export type RefreshSchema = z.infer<typeof refreshSchema>;
export type LogoutSchema = z.infer<typeof logoutSchema>;

export const otpPurposeSchema = z.enum(['signup', 'login', 'password_reset', 'phone_change', 'email_change']);

export const sendEmailVerificationSchema = z.object({
  email: z.email().trim().toLowerCase()
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1)
});

export const sendOtpSchema = z.object({
  phoneNumber: phoneNumberSchema,
  purpose: otpPurposeSchema
});

export const verifyOtpSchema = z.object({
  phoneNumber: phoneNumberSchema,
  purpose: otpPurposeSchema,
  code: z.string().trim().min(4).max(10)
});

export type SendEmailVerificationSchema = z.infer<typeof sendEmailVerificationSchema>;
export type VerifyEmailSchema = z.infer<typeof verifyEmailSchema>;
export type SendOtpSchema = z.infer<typeof sendOtpSchema>;
export type VerifyOtpSchema = z.infer<typeof verifyOtpSchema>;