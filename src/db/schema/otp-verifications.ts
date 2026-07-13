import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { users } from './users.js';
import { otpPurposeEnum } from './enums.js';

export const otpVerifications = pgTable(
  'otp_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    phoneNumber: text('phone_number').notNull(),
    otpHash: text('otp_hash').notNull(),
    purpose: otpPurposeEnum('purpose').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    userIdIdx: index('otp_verifications_user_id_idx').on(table.userId),
    phoneNumberIdx: index('otp_verifications_phone_number_idx').on(table.phoneNumber),
    expiresAtIdx: index('otp_verifications_expires_at_idx').on(table.expiresAt)
  })
);
