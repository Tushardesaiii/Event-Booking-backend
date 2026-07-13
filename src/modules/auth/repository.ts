import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema/audit-logs.js';
import { authAccounts } from '../../db/schema/auth-accounts.js';
import { sessions } from '../../db/schema/sessions.js';
import { signupVerificationSessions } from '../../db/schema/signup-verification-sessions.js';
import { tenantMembers } from '../../db/schema/tenant-members.js';
import { users } from '../../db/schema/users.js';
import { verificationTokens } from '../../db/schema/verification-tokens.js';

type AuthDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

export interface CreateSessionInput {
  id?: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface CreateAuthAccountInput {
  userId: string;
  provider: 'email' | 'phone' | 'google' | 'apple' | 'whatsapp' | 'magic_link';
  email?: string | null;
  phone?: string | null;
  passwordHash?: string | null;
  providerAccountId?: string | null;
  isPrimary?: boolean;
  isVerified?: boolean;
  lastLoginAt?: Date | null;
}

export interface CreateSignupVerificationSessionInput {
  phoneNumber: string;
  email: string;
  username: string;
  fullName: string;
  passwordHash: string;
  expiresAt: Date;
  marketingOptIn?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateAuditLogInput {
  eventType:
    | 'signup_started'
    | 'otp_sent'
    | 'otp_resend'
    | 'otp_verified'
    | 'otp_failed'
    | 'signup_completed';
  actorType?: 'anonymous' | 'user' | 'system';
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  username?: string | null;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateVerificationTokenInput {
  userId: string;
  type: 'email_verify' | 'phone_otp' | 'password_reset' | 'invite';
  target: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
}

export async function findUserById(database: AuthDatabase, userId: string) {
  const [user] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export async function findUserByUsername(database: AuthDatabase, username: string) {
  const [user] = await database.select().from(users).where(eq(users.username, username)).limit(1);
  return user ?? null;
}

export async function findUserByPhoneNumber(database: AuthDatabase, phoneNumber: string) {
  const [user] = await database.select().from(users).where(eq(users.phoneNumber, phoneNumber)).limit(1);
  return user ?? null;
}

export async function findAuthAccountByProviderAndAccountId(
  database: AuthDatabase,
  provider: CreateAuthAccountInput['provider'],
  providerAccountId: string
) {
  const [authAccount] = await database
    .select()
    .from(authAccounts)
    .where(and(eq(authAccounts.provider, provider), eq(authAccounts.providerAccountId, providerAccountId)))
    .limit(1);

  return authAccount ?? null;
}

export async function findAuthAccountsByUserId(database: AuthDatabase, userId: string) {
  return database.select().from(authAccounts).where(eq(authAccounts.userId, userId));
}

export async function createUserRecord(database: AuthDatabase, input: {
  username: string;
  full_name: string;
  phoneNumber?: string | null;
  phoneVerifiedAt?: Date | null;
  email?: string | null;
  avatarAssetId?: string | null;
  bio?: string | null;
  marketingOptIn?: boolean;
}) {
  const [user] = await database
    .insert(users)
    .values({
      username: input.username,
      fullName: input.full_name,
      phoneNumber: input.phoneNumber ?? null,
      phoneVerifiedAt: input.phoneVerifiedAt ?? null,
      email: input.email ?? null,
      avatarAssetId: input.avatarAssetId ?? null,
      bio: input.bio ?? null,
      marketingOptIn: input.marketingOptIn ?? null
    })
    .returning();

  return user ?? null;
}

export async function createAuthAccount(database: AuthDatabase, input: CreateAuthAccountInput) {
  const [authAccount] = await database
    .insert(authAccounts)
    .values({
      userId: input.userId,
      provider: input.provider,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash ?? null,
      providerAccountId: input.providerAccountId ?? null,
      isPrimary: input.isPrimary ?? false,
      isVerified: input.isVerified ?? false,
      lastLoginAt: input.lastLoginAt ?? null
    })
    .returning();

  return authAccount ?? null;
}

export async function createVerificationToken(database: AuthDatabase, input: CreateVerificationTokenInput) {
  const [token] = await database
    .insert(verificationTokens)
    .values({
      userId: input.userId,
      type: input.type,
      target: input.target,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: input.usedAt ?? null
    })
    .returning();

  return token ?? null;
}

export async function createSessionRecord(database: AuthDatabase, input: CreateSessionInput) {
  const [session] = await database
    .insert(sessions)
    .values({
      id: input.id,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null
    })
    .returning();

  return session ?? null;
}

export async function createSignupVerificationSession(
  database: AuthDatabase,
  input: CreateSignupVerificationSessionInput
) {
  const [session] = await database
    .insert(signupVerificationSessions)
    .values({
      phoneNumber: input.phoneNumber,
      email: input.email,
      username: input.username,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      marketingOptIn: input.marketingOptIn ?? false,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null
    })
    .returning();

  return session ?? null;
}

export async function findSignupVerificationSessionById(database: AuthDatabase, sessionId: string) {
  const [session] = await database
    .select()
    .from(signupVerificationSessions)
    .where(eq(signupVerificationSessions.id, sessionId))
    .limit(1);

  return session ?? null;
}

export async function updateSignupVerificationSessionVerificationSid(
  database: AuthDatabase,
  sessionId: string,
  verificationSid: string
) {
  const [session] = await database
    .update(signupVerificationSessions)
    .set({
      verificationSid,
      updatedAt: new Date()
    })
    .where(eq(signupVerificationSessions.id, sessionId))
    .returning();

  return session ?? null;
}

export async function markSignupVerificationSessionVerified(
  database: AuthDatabase,
  sessionId: string,
  verifiedAt: Date
) {
  const [session] = await database
    .update(signupVerificationSessions)
    .set({
      status: 'verified',
      verifiedAt,
      updatedAt: verifiedAt
    })
    .where(and(eq(signupVerificationSessions.id, sessionId), eq(signupVerificationSessions.status, 'pending')))
    .returning();

  return session ?? null;
}

export async function markSignupVerificationSessionExpired(database: AuthDatabase, sessionId: string) {
  const expiredAt = new Date();
  const [session] = await database
    .update(signupVerificationSessions)
    .set({
      status: 'expired',
      updatedAt: expiredAt
    })
    .where(eq(signupVerificationSessions.id, sessionId))
    .returning();

  return session ?? null;
}

export async function markSignupVerificationSessionCancelled(database: AuthDatabase, sessionId: string) {
  const cancelledAt = new Date();
  const [session] = await database
    .update(signupVerificationSessions)
    .set({
      status: 'cancelled',
      updatedAt: cancelledAt
    })
    .where(eq(signupVerificationSessions.id, sessionId))
    .returning();

  return session ?? null;
}

export async function claimSignupVerificationAttempt(
  database: AuthDatabase,
  sessionId: string,
  maxAttempts = 5
) {
  const [session] = await database
    .update(signupVerificationSessions)
    .set({
      attemptCount: sql<number>`${signupVerificationSessions.attemptCount} + 1`,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(signupVerificationSessions.id, sessionId),
        eq(signupVerificationSessions.status, 'pending'),
        gte(signupVerificationSessions.expiresAt, new Date()),
        sql`${signupVerificationSessions.attemptCount} < ${maxAttempts}`
      )
    )
    .returning();

  return session ?? null;
}

export async function countSignupVerificationAuditEvents(
  database: AuthDatabase,
  criteria: {
    phoneNumber?: string | null;
    ipAddress?: string | null;
    since: Date;
  }
) {
  const eventTypes = ['signup_started', 'otp_resend'] as const;
  const conditions = [gte(auditLogs.createdAt, criteria.since), inArray(auditLogs.eventType, eventTypes)];

  if (criteria.phoneNumber) {
    conditions.push(eq(auditLogs.phoneNumber, criteria.phoneNumber));
  }

  if (criteria.ipAddress) {
    conditions.push(eq(auditLogs.ipAddress, criteria.ipAddress));
  }

  const [row] = await database.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(and(...conditions));
  return Number(row?.count ?? 0);
}

export async function createAuditLogRecord(database: AuthDatabase, input: CreateAuditLogInput) {
  const [log] = await database
    .insert(auditLogs)
    .values({
      eventType: input.eventType,
      actorType: input.actorType ?? 'anonymous',
      actorUserId: input.actorUserId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      phoneNumber: input.phoneNumber ?? null,
      email: input.email ?? null,
      username: input.username ?? null,
      correlationId: input.correlationId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? {}
    })
    .returning();

  return log ?? null;
}

export async function updateAuthAccountLastLoginAt(database: AuthDatabase, authAccountId: string, lastLoginAt: Date) {
  const [updated] = await database
    .update(authAccounts)
    .set({ lastLoginAt })
    .where(eq(authAccounts.id, authAccountId))
    .returning();

  return updated ?? null;
}

export async function findSessionById(database: AuthDatabase, sessionId: string) {
  const [session] = await database.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return session ?? null;
}

export async function deleteSessionById(database: AuthDatabase, sessionId: string) {
  await database.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function updateSessionRefreshTokenHash(
  database: AuthDatabase,
  sessionId: string,
  refreshTokenHash: string,
  expiresAt: Date
) {
  const [session] = await database
    .update(sessions)
    .set({
      refreshTokenHash,
      expiresAt
    })
    .where(eq(sessions.id, sessionId))
    .returning();

  return session ?? null;
}

export async function findMembershipsForUser(database: AuthDatabase, userId: string) {
  return database.select().from(tenantMembers).where(eq(tenantMembers.userId, userId));
}
