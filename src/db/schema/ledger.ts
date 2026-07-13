import { index, jsonb, numeric, pgTable, text, timestamp, uuid, pgEnum, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { organizers } from '../../modules/organizer-profiles/schema.js';

export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', [
  'PLATFORM_ESCROW',
  'PLATFORM_REVENUE',
  'ORGANIZER_BALANCE',
  'CUSTOMER_REFUNDS',
  'TAX_PAYABLE',
  'PAYMENT_GATEWAY_CLEARING',
  // Extended Enterprise Types
  'PLATFORM_CASH',
  'CUSTOMER_CASH',
  'CUSTOMER_LIABILITY',
  'ESCROW',
  'ORGANIZER_PENDING',
  'ORGANIZER_AVAILABLE',
  'ORGANIZER_PAYABLE',
  'PLATFORM_FEE_REVENUE',
  'GATEWAY_FEE_EXPENSE',
  'REFUND_LIABILITY',
  'CHARGEBACK_RESERVE',
  'RESERVE',
  'SETTLEMENT_CLEARING',
  'WITHDRAWAL_CLEARING',
  'SYSTEM_ADJUSTMENT',
  'FRAUD_RESERVE',
  'SUSPENSE_ACCOUNT'
]);

export const ledgerEntryDirectionEnum = pgEnum('ledger_entry_direction', [
  'debit',
  'credit'
]);

export const withdrawalStatusEnum = pgEnum('withdrawal_status', [
  'pending',
  'approved',
  'processing',
  'completed',
  'failed',
  'rejected'
]);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    type: ledgerAccountTypeEnum('type').notNull(),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('active'),
    precision: integer('precision').notNull().default(2),
    minorUnit: integer('minor_unit').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_accounts_tenant_id_idx').on(table.tenantId),
    tenantTypeNameUnique: uniqueIndex('ledger_accounts_tenant_type_name_unique').on(table.tenantId, table.type, table.name),
    typeIdx: index('ledger_accounts_type_idx').on(table.type),
    statusIdx: index('ledger_accounts_status_idx').on(table.status)
  })
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    transactionType: text('transaction_type').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    previousHash: text('previous_hash'),
    currentHash: text('current_hash'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_transactions_tenant_id_idx').on(table.tenantId),
    referenceIdx: index('ledger_transactions_reference_idx').on(table.referenceType, table.referenceId),
    createdAtIdx: index('ledger_transactions_created_at_idx').on(table.createdAt)
  })
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').notNull().references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    ledgerTransactionId: uuid('ledger_transaction_id').notNull().references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    direction: ledgerEntryDirectionEnum('direction').notNull(),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_entries_tenant_id_idx').on(table.tenantId),
    accountIdx: index('ledger_entries_account_id_idx').on(table.accountId),
    ledgerTransactionIdx: index('ledger_entries_ledger_transaction_id_idx').on(table.ledgerTransactionId),
    referenceIdx: index('ledger_entries_reference_idx').on(table.referenceType, table.referenceId),
    createdAtIdx: index('ledger_entries_created_at_idx').on(table.createdAt)
  })
);

export const organizerWallets = pgTable(
  'organizer_wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, { onDelete: 'restrict' }),
    availableBalance: numeric('available_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    pendingBalance: numeric('pending_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    withdrawnBalance: numeric('withdrawn_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('organizer_wallets_tenant_id_idx').on(table.tenantId),
    organizerIdx: index('organizer_wallets_organizer_id_idx').on(table.organizerId)
  })
);

export const organizerWalletTransactions = pgTable(
  'organizer_wallet_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, { onDelete: 'restrict' }),
    walletId: uuid('wallet_id').notNull().references(() => organizerWallets.id, { onDelete: 'restrict' }),
    type: text('type').notNull(), // 'credit', 'debit'
    status: text('status').notNull(), // 'pending', 'settled', 'failed', 'pending_withdrawal', 'completed'
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('organizer_wallet_transactions_tenant_id_idx').on(table.tenantId),
    organizerIdx: index('organizer_wallet_transactions_organizer_id_idx').on(table.organizerId),
    walletIdx: index('organizer_wallet_transactions_wallet_id_idx').on(table.walletId),
    referenceIdx: index('organizer_wallet_transactions_reference_idx').on(table.referenceType, table.referenceId),
    createdAtIdx: index('organizer_wallet_transactions_created_at_idx').on(table.createdAt)
  })
);

export const withdrawalRequests = pgTable(
  'withdrawal_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    organizerId: uuid('organizer_id').notNull().references(() => organizers.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: withdrawalStatusEnum('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    processedBy: uuid('processed_by').references(() => users.id, { onDelete: 'set null' }),
    gatewayPayoutId: text('gateway_payout_id'),
    gatewayStatus: text('gateway_status'),
    retryCount: integer('retry_count').notNull().default(0),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('withdrawal_requests_tenant_id_idx').on(table.tenantId),
    organizerIdx: index('withdrawal_requests_organizer_id_idx').on(table.organizerId),
    statusIdx: index('withdrawal_requests_status_idx').on(table.status)
  })
);

export const settlementRuns = pgTable(
  'settlement_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull(), // 'completed', 'failed', 'discrepancies_found'
    discrepancies: jsonb('discrepancies').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    retryCount: integer('retry_count').notNull().default(0),
    notes: text('notes')
  },
  (table) => ({
    tenantIdx: index('settlement_runs_tenant_id_idx').on(table.tenantId),
    createdAtIdx: index('settlement_runs_created_at_idx').on(table.createdAt)
  })
);

// New Enterprise Ledger tables

export const ledgerSnapshots = pgTable(
  'ledger_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').notNull().references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    lastTransactionId: uuid('last_transaction_id').notNull().references(() => ledgerTransactions.id, { onDelete: 'restrict' }),
    balance: numeric('balance', { precision: 14, scale: 2 }).notNull(),
    debitBalance: numeric('debit_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    creditBalance: numeric('credit_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_snapshots_tenant_id_idx').on(table.tenantId),
    accountIdx: index('ledger_snapshots_account_id_idx').on(table.accountId),
    createdAtIdx: index('ledger_snapshots_created_at_idx').on(table.createdAt)
  })
);

export const ledgerAccountBalances = pgTable(
  'ledger_account_balances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').notNull().references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    balance: numeric('balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    debitBalance: numeric('debit_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    creditBalance: numeric('credit_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_account_balances_tenant_id_idx').on(table.tenantId),
    accountTenantUnique: uniqueIndex('ledger_account_balances_tenant_account_unique').on(table.tenantId, table.accountId),
    accountIdx: index('ledger_account_balances_account_id_idx').on(table.accountId),
    updatedAtIdx: index('ledger_account_balances_updated_at_idx').on(table.updatedAt)
  })
);

export const ledgerLocks = pgTable(
  'ledger_locks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    lockKey: text('lock_key').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => ({
    tenantIdx: index('ledger_locks_tenant_id_idx').on(table.tenantId),
    tenantLockKeyUnique: uniqueIndex('ledger_locks_tenant_lock_key_unique').on(table.tenantId, table.lockKey),
    lockKeyIdx: index('ledger_locks_lock_key_idx').on(table.lockKey)
  })
);

export const ledgerReconciliation = pgTable(
  'ledger_reconciliation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    runType: text('run_type').notNull(), // 'payments', 'ledger', 'escrow', etc.
    status: text('status').notNull(), // 'completed', 'failed', 'discrepancies_found'
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
    discrepancies: jsonb('discrepancies').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_reconciliation_tenant_id_idx').on(table.tenantId),
    createdAtIdx: index('ledger_reconciliation_created_at_idx').on(table.createdAt)
  })
);

export const ledgerAuditLogs = pgTable(
  'ledger_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    ipAddress: text('ip_address'),
    requestId: text('request_id'),
    source: text('source'),
    reference: text('reference'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    transactionHash: text('transaction_hash').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_audit_logs_tenant_id_idx').on(table.tenantId),
    userIdx: index('ledger_audit_logs_user_id_idx').on(table.userId),
    entityIdx: index('ledger_audit_logs_entity_idx').on(table.entityType, table.entityId),
    createdAtIdx: index('ledger_audit_logs_created_at_idx').on(table.createdAt)
  })
);

export const ledgerIdempotencyKeys = pgTable(
  'ledger_idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    paymentId: text('payment_id'),
    razorpayPaymentId: text('razorpay_payment_id'),
    bookingId: text('booking_id'),
    orderId: text('order_id'),
    withdrawalId: text('withdrawal_id'),
    refundId: text('refund_id'),
    responsePayload: jsonb('response_payload'),
    status: text('status').notNull(), // 'pending', 'completed', 'failed'
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_idempotency_keys_tenant_id_idx').on(table.tenantId),
    tenantIdempotencyKeyUnique: uniqueIndex('ledger_idempotency_keys_tenant_key_unique').on(table.tenantId, table.idempotencyKey),
    keyIdx: index('ledger_idempotency_keys_idempotency_key_idx').on(table.idempotencyKey),
    paymentIdx: index('ledger_idempotency_keys_payment_idx').on(table.paymentId),
    razorpayPaymentIdx: index('ledger_idempotency_keys_razorpay_payment_idx').on(table.razorpayPaymentId),
    bookingIdx: index('ledger_idempotency_keys_booking_idx').on(table.bookingId),
    orderIdx: index('ledger_idempotency_keys_order_idx').on(table.orderId),
    withdrawalIdx: index('ledger_idempotency_keys_withdrawal_idx').on(table.withdrawalId),
    refundIdx: index('ledger_idempotency_keys_refund_idx').on(table.refundId)
  })
);

export const ledgerEvents = pgTable(
  'ledger_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'), // 'pending', 'published', 'failed'
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('ledger_events_tenant_id_idx').on(table.tenantId),
    statusIdx: index('ledger_events_status_idx').on(table.status),
    createdAtIdx: index('ledger_events_created_at_idx').on(table.createdAt)
  })
);

export const financialOperations = pgTable(
  'financial_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    operationType: text('operation_type').notNull(),
    status: text('status').notNull().default('pending'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
    currency: text('currency').notNull().default('INR'),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    ledgerTransactionId: uuid('ledger_transaction_id').references(() => ledgerTransactions.id, { onDelete: 'set null' }),
    riskScore: integer('risk_score'),
    requestId: text('request_id'),
    correlationId: text('correlation_id'),
    traceId: text('trace_id'),
    ipAddress: text('ip_address'),
    deviceInfo: jsonb('device_info').notNull().default(sql`'{}'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('financial_operations_tenant_id_idx').on(table.tenantId),
    operationTypeIdx: index('financial_operations_operation_type_idx').on(table.operationType),
    statusIdx: index('financial_operations_status_idx').on(table.status),
    referenceIdx: index('financial_operations_reference_idx').on(table.referenceType, table.referenceId),
    tenantIdempotencyUnique: uniqueIndex('financial_operations_tenant_idempotency_unique').on(table.tenantId, table.idempotencyKey),
    createdAtIdx: index('financial_operations_created_at_idx').on(table.createdAt)
  })
);

export const financialOperationEvents = pgTable(
  'financial_operation_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    operationId: uuid('operation_id').references(() => financialOperations.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    requestId: text('request_id'),
    correlationId: text('correlation_id'),
    traceId: text('trace_id'),
    previousHash: text('previous_hash'),
    currentHash: text('current_hash'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('financial_operation_events_tenant_id_idx').on(table.tenantId),
    operationIdx: index('financial_operation_events_operation_id_idx').on(table.operationId),
    eventTypeIdx: index('financial_operation_events_event_type_idx').on(table.eventType),
    createdAtIdx: index('financial_operation_events_created_at_idx').on(table.createdAt)
  })
);

// Drizzle relations
export const ledgerAccountsRelations = relations(ledgerAccounts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ledgerAccounts.tenantId], references: [tenants.id] }),
  entries: many(ledgerEntries)
}));

export const ledgerTransactionsRelations = relations(ledgerTransactions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ledgerTransactions.tenantId], references: [tenants.id] }),
  entries: many(ledgerEntries)
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  tenant: one(tenants, { fields: [ledgerEntries.tenantId], references: [tenants.id] }),
  account: one(ledgerAccounts, { fields: [ledgerEntries.accountId], references: [ledgerAccounts.id] }),
  transaction: one(ledgerTransactions, { fields: [ledgerEntries.ledgerTransactionId], references: [ledgerTransactions.id] })
}));

export const organizerWalletsRelations = relations(organizerWallets, ({ one, many }) => ({
  tenant: one(tenants, { fields: [organizerWallets.tenantId], references: [tenants.id] }),
  organizer: one(organizers, { fields: [organizerWallets.organizerId], references: [organizers.id] }),
  transactions: many(organizerWalletTransactions)
}));

export const organizerWalletTransactionsRelations = relations(organizerWalletTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [organizerWalletTransactions.tenantId], references: [tenants.id] }),
  organizer: one(organizers, { fields: [organizerWalletTransactions.organizerId], references: [organizers.id] }),
  wallet: one(organizerWallets, { fields: [organizerWalletTransactions.walletId], references: [organizerWallets.id] })
}));

export const withdrawalRequestsRelations = relations(withdrawalRequests, ({ one }) => ({
  tenant: one(tenants, { fields: [withdrawalRequests.tenantId], references: [tenants.id] }),
  organizer: one(organizers, { fields: [withdrawalRequests.organizerId], references: [organizers.id] }),
  processedByUser: one(users, { fields: [withdrawalRequests.processedBy], references: [users.id] })
}));

export const settlementRunsRelations = relations(settlementRuns, ({ one }) => ({
  tenant: one(tenants, { fields: [settlementRuns.tenantId], references: [tenants.id] })
}));

export const ledgerSnapshotsRelations = relations(ledgerSnapshots, ({ one }) => ({
  tenant: one(tenants, { fields: [ledgerSnapshots.tenantId], references: [tenants.id] }),
  account: one(ledgerAccounts, { fields: [ledgerSnapshots.accountId], references: [ledgerAccounts.id] }),
  lastTransaction: one(ledgerTransactions, { fields: [ledgerSnapshots.lastTransactionId], references: [ledgerTransactions.id] })
}));

export const ledgerAccountBalancesRelations = relations(ledgerAccountBalances, ({ one }) => ({
  tenant: one(tenants, { fields: [ledgerAccountBalances.tenantId], references: [tenants.id] }),
  account: one(ledgerAccounts, { fields: [ledgerAccountBalances.accountId], references: [ledgerAccounts.id] })
}));

export const ledgerReconciliationRelations = relations(ledgerReconciliation, ({ one }) => ({
  tenant: one(tenants, { fields: [ledgerReconciliation.tenantId], references: [tenants.id] })
}));

export const ledgerAuditLogsRelations = relations(ledgerAuditLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [ledgerAuditLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [ledgerAuditLogs.userId], references: [users.id] })
}));

export const ledgerIdempotencyKeysRelations = relations(ledgerIdempotencyKeys, ({ one }) => ({
  tenant: one(tenants, { fields: [ledgerIdempotencyKeys.tenantId], references: [tenants.id] })
}));

export const ledgerEventsRelations = relations(ledgerEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [ledgerEvents.tenantId], references: [tenants.id] })
}));

export const financialOperationsRelations = relations(financialOperations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [financialOperations.tenantId], references: [tenants.id] }),
  actor: one(users, { fields: [financialOperations.actorId], references: [users.id] }),
  approver: one(users, { fields: [financialOperations.approvedBy], references: [users.id] }),
  ledgerTransaction: one(ledgerTransactions, {
    fields: [financialOperations.ledgerTransactionId],
    references: [ledgerTransactions.id]
  }),
  events: many(financialOperationEvents)
}));

export const financialOperationEventsRelations = relations(financialOperationEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [financialOperationEvents.tenantId], references: [tenants.id] }),
  operation: one(financialOperations, {
    fields: [financialOperationEvents.operationId],
    references: [financialOperations.id]
  }),
  actor: one(users, { fields: [financialOperationEvents.actorId], references: [users.id] })
}));
