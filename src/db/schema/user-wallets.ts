import { index, pgTable, text, timestamp, uuid, integer, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { bookingOrders } from './booking-orders.js';

export const userWallets = pgTable(
  'user_wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    balance: numeric('balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    rewardPoints: integer('reward_points').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    userUnique: uniqueIndex('user_wallets_user_id_unique').on(table.userId),
    userIdIdx: index('user_wallets_user_id_idx').on(table.userId)
  })
);

export const userWalletTransactions = pgTable(
  'user_wallet_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    walletId: uuid('wallet_id').notNull().references(() => userWallets.id, { onDelete: 'restrict' }),
    type: text('type').notNull(), // 'credit', 'debit'
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    referenceType: text('reference_type').notNull(), // 'recharge', 'ticket_purchase', 'refund', 'transfer'
    referenceId: text('reference_id').notNull(), // reference uuid or string (bookingId, rechargeId, etc.)
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    userIdIdx: index('user_wallet_transactions_user_id_idx').on(table.userId),
    walletIdIdx: index('user_wallet_transactions_wallet_id_idx').on(table.walletId),
    referenceIdx: index('user_wallet_transactions_reference_idx').on(table.referenceType, table.referenceId),
    createdAtIdx: index('user_wallet_transactions_created_at_idx').on(table.createdAt)
  })
);

export const userWalletRecharges = pgTable(
  'user_wallet_recharges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    razorpayOrderId: text('razorpay_order_id').notNull(),
    razorpayPaymentId: text('razorpay_payment_id'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('pending'), // 'pending', 'completed', 'failed'
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    userIdIdx: index('user_wallet_recharges_user_id_idx').on(table.userId),
    razorpayOrderIdx: index('user_wallet_recharges_razorpay_order_id_idx').on(table.razorpayOrderId),
    statusIdx: index('user_wallet_recharges_status_idx').on(table.status),
    createdAtIdx: index('user_wallet_recharges_created_at_idx').on(table.createdAt)
  })
);

export const userWalletsRelations = relations(userWallets, ({ one, many }) => ({
  user: one(users, {
    fields: [userWallets.userId],
    references: [users.id]
  }),
  transactions: many(userWalletTransactions)
}));

export const userWalletTransactionsRelations = relations(userWalletTransactions, ({ one }) => ({
  user: one(users, {
    fields: [userWalletTransactions.userId],
    references: [users.id]
  }),
  wallet: one(userWallets, {
    fields: [userWalletTransactions.walletId],
    references: [userWallets.id]
  })
}));

export const userWalletRechargesRelations = relations(userWalletRecharges, ({ one }) => ({
  user: one(users, {
    fields: [userWalletRecharges.userId],
    references: [users.id]
  })
}));
