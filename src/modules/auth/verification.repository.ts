import { and, eq, gte, isNull, desc, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { emailVerificationTokens } from '../../db/schema/email-verification-tokens.js';
import { otpVerifications } from '../../db/schema/otp-verifications.js';
import { users } from '../../db/schema/users.js';
import { authAccounts } from '../../db/schema/auth-accounts.js';

type VerificationDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

// 1. Email Verification Repository functions
export async function createEmailVerificationToken(
  database: VerificationDatabase,
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }
) {
  const [token] = await database
    .insert(emailVerificationTokens)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt
    })
    .returning();

  return token ?? null;
}

export async function findEmailVerificationTokenByHash(
  database: VerificationDatabase,
  tokenHash: string
) {
  const [token] = await database
    .select()
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, tokenHash),
        isNull(emailVerificationTokens.deletedAt)
      )
    )
    .limit(1);

  return token ?? null;
}

export async function markEmailVerificationTokenVerified(
  database: VerificationDatabase,
  tokenId: string
) {
  const [token] = await database
    .update(emailVerificationTokens)
    .set({
      verifiedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(emailVerificationTokens.id, tokenId))
    .returning();

  return token ?? null;
}

export async function softDeleteEmailVerificationTokensForUser(
  database: VerificationDatabase,
  userId: string
) {
  await database
    .update(emailVerificationTokens)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        isNull(emailVerificationTokens.deletedAt),
        isNull(emailVerificationTokens.verifiedAt)
      )
    );
}

// 2. OTP Repository functions
export async function createOtpVerification(
  database: VerificationDatabase,
  input: {
    userId: string | null;
    phoneNumber: string;
    otpHash: string;
    purpose: 'signup' | 'login' | 'password_reset' | 'phone_change' | 'email_change';
    expiresAt: Date;
  }
) {
  const [otp] = await database
    .insert(otpVerifications)
    .values({
      userId: input.userId,
      phoneNumber: input.phoneNumber,
      otpHash: input.otpHash,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      attempts: 0
    })
    .returning();

  return otp ?? null;
}

export async function findLatestActiveOtpVerification(
  database: VerificationDatabase,
  phoneNumber: string,
  purpose: 'signup' | 'login' | 'password_reset' | 'phone_change' | 'email_change'
) {
  const [otp] = await database
    .select()
    .from(otpVerifications)
    .where(
      and(
        eq(otpVerifications.phoneNumber, phoneNumber),
        eq(otpVerifications.purpose, purpose),
        isNull(otpVerifications.deletedAt),
        isNull(otpVerifications.verifiedAt),
        gte(otpVerifications.expiresAt, new Date())
      )
    )
    .orderBy(desc(otpVerifications.createdAt))
    .limit(1);

  return otp ?? null;
}

export async function incrementOtpAttempts(
  database: VerificationDatabase,
  otpId: string
) {
  const [otp] = await database
    .update(otpVerifications)
    .set({
      attempts: sql`${otpVerifications.attempts} + 1`,
      updatedAt: new Date()
    })
    .where(eq(otpVerifications.id, otpId))
    .returning();

  return otp ?? null;
}

export async function markOtpVerificationVerified(
  database: VerificationDatabase,
  otpId: string
) {
  const [otp] = await database
    .update(otpVerifications)
    .set({
      verifiedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(otpVerifications.id, otpId))
    .returning();

  return otp ?? null;
}

export async function softDeleteOtpVerificationsForPhone(
  database: VerificationDatabase,
  phoneNumber: string,
  purpose: string
) {
  await database
    .update(otpVerifications)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(otpVerifications.phoneNumber, phoneNumber),
        eq(otpVerifications.purpose, purpose as any),
        isNull(otpVerifications.deletedAt),
        isNull(otpVerifications.verifiedAt)
      )
    );
}

// 3. User Updates
export async function updateUserEmailVerified(
  database: VerificationDatabase,
  userId: string,
  verifiedAt: Date | null
) {
  const [user] = await database
    .update(users)
    .set({
      emailVerifiedAt: verifiedAt,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId))
    .returning();

  return user ?? null;
}

export async function updateUserPhoneVerified(
  database: VerificationDatabase,
  userId: string,
  verifiedAt: Date | null
) {
  const [user] = await database
    .update(users)
    .set({
      phoneVerifiedAt: verifiedAt,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId))
    .returning();

  return user ?? null;
}

export async function findUserByEmailAddress(
  database: VerificationDatabase,
  email: string
) {
  const [account] = await database
    .select()
    .from(authAccounts)
    .where(eq(authAccounts.email, email.trim().toLowerCase()))
    .limit(1);

  if (!account) return null;

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, account.userId))
    .limit(1);

  return user ?? null;
}

export async function findUserByPhone(
  database: VerificationDatabase,
  phoneNumber: string
) {
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.phoneNumber, phoneNumber.trim()))
    .limit(1);

  return user ?? null;
}
