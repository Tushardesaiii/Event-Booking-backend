import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { signupVerificationStatusEnum, verificationProviderEnum } from './enums.js';
import { timestampColumns } from './helpers.js';

export const signupVerificationSessions = pgTable(
  'signup_verification_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phoneNumber: text('phone_number').notNull(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    marketingOptIn: boolean('marketing_opt_in').default(false),
    verificationProvider: verificationProviderEnum('verification_provider').notNull().default('twilio_verify'),
    verificationSid: text('verification_sid'),
    status: signupVerificationStatusEnum('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    verifiedAt: timestamp('verified_at', {
      withTimezone: true,
      mode: 'date'
    }),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestampColumns
  },
  (table) => ({
    phoneNumberIdx: index('signup_verification_sessions_phone_number_idx').on(table.phoneNumber),
    emailIdx: index('signup_verification_sessions_email_idx').on(table.email),
    statusIdx: index('signup_verification_sessions_status_idx').on(table.status),
    expiresAtIdx: index('signup_verification_sessions_expires_at_idx').on(table.expiresAt),
    usernameIdx: index('signup_verification_sessions_username_idx').on(table.username)
  })
);
