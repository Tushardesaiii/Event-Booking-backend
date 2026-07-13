import type { InferSelectModel } from 'drizzle-orm';

import type { authAccounts } from '../db/schema/auth-accounts.js';
import type { tenantMembers } from '../db/schema/tenant-members.js';
import type { tenants } from '../db/schema/tenants.js';
import type { users } from '../db/schema/users.js';
import type { sessions } from '../db/schema/sessions.js';
import type { verificationTokens } from '../db/schema/verification-tokens.js';

export type AuthUser = InferSelectModel<typeof users>;
export type PublicAuthUser = AuthUser;
export type AuthAccount = InferSelectModel<typeof authAccounts>;
export type SessionRecord = InferSelectModel<typeof sessions>;
export type VerificationTokenRecord = InferSelectModel<typeof verificationTokens>;
export type TenantRecord = InferSelectModel<typeof tenants>;
export type TenantMembershipRecord = InferSelectModel<typeof tenantMembers>;

export type TenantMemberRole = TenantMembershipRecord['role'];

export interface JwtTokenClaims {
  sub: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
  sid?: string;
  tenantId?: string;
  role?: string;
}

export interface AuthContext {
  user: PublicAuthUser | null;
  authToken: string | null;
}
