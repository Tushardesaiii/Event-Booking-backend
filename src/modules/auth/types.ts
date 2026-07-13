import type { AuthAccount, PublicAuthUser, TenantMembershipRecord } from '../../types/auth.js';

export interface SignupStartInput {
  fullName: string;
  username: string;
  email: string;
  password: string;
  phoneNumber: string;
  marketingOptIn?: boolean;
}

export interface SignupVerifyInput {
  verificationSessionId: string;
  code: string;
}

export interface SignupResendInput {
  verificationSessionId: string;
}

export interface SignupStartResponse {
  verificationSessionId: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface OrganizerRegisterInput {
  fullName: string;
  organizationName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken: string;
}

export interface AuthSessionPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface AuthMeResponse {
  user: PublicAuthUser;
  authAccounts: Omit<AuthAccount, 'passwordHash'>[];
  tenantMemberships: TenantMembershipRecord[];
}

export interface AuthResult {
  user: PublicAuthUser;
  session: {
    id: string;
    expiresAt: Date;
  };
  tokens: AuthSessionPayload;
}

export interface SignupVerificationSessionRecord {
  id: string;
  phoneNumber: string;
  email: string;
  username: string;
  fullName: string;
  passwordHash: string;
  verificationProvider: 'twilio_verify';
  verificationSid: string | null;
  status: 'pending' | 'verified' | 'expired' | 'cancelled';
  attemptCount: number;
  verifiedAt: Date | null;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthIdentityLookup {
  identifier: string;
}