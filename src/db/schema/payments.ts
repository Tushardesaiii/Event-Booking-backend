import { index, jsonb, numeric, pgTable, text, timestamp, uuid, pgEnum, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { bookingOrders } from './booking-orders.js';
import { users } from './users.js';
import { timestampColumns } from './helpers.js';

export const paymentOrderStatusEnum = pgEnum('payment_order_status', [
  'created',
  'pending',
  'authorized',
  'partially_captured',
  'captured',
  'failed',
  'cancelled',
  'expired',
  'partially_refunded',
  'refunded'
]);

export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    bookingOrderId: uuid('booking_order_id').notNull().references(() => bookingOrders.id, { onDelete: 'restrict' }),
    razorpayOrderId: text('razorpay_order_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    capturedAmount: numeric('captured_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
    currency: text('currency').notNull(),
    status: paymentOrderStatusEnum('status').notNull().default('pending'),
    receiptStatus: text('receipt_status').notNull().default('pending'),
    invoiceStatus: text('invoice_status').notNull().default('not_generated'),
    retryCount: integer('retry_count').notNull().default(0),
    providerState: jsonb('provider_state').notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    ...timestampColumns
  },
  (table) => ({
    tenantIdx: index('payment_orders_tenant_id_idx').on(table.tenantId),
    tenantBookingUnique: uniqueIndex('payment_orders_tenant_booking_unique').on(table.tenantId, table.bookingOrderId),
    tenantRazorpayOrderUnique: uniqueIndex('payment_orders_tenant_razorpay_order_unique').on(table.tenantId, table.razorpayOrderId),
    bookingOrderIdx: index('payment_orders_booking_order_id_idx').on(table.bookingOrderId),
    razorpayOrderIdx: index('payment_orders_razorpay_order_id_idx').on(table.razorpayOrderId),
    statusIdx: index('payment_orders_status_idx').on(table.status),
    createdAtIdx: index('payment_orders_created_at_idx').on(table.createdAt)
  })
);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    paymentOrderId: uuid('payment_order_id').notNull().references(() => paymentOrders.id, { onDelete: 'restrict' }),
    razorpayPaymentId: text('razorpay_payment_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    gatewayResponse: jsonb('gateway_response').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('payment_transactions_tenant_id_idx').on(table.tenantId),
    tenantRazorpayPaymentUnique: uniqueIndex('payment_transactions_tenant_razorpay_payment_unique').on(table.tenantId, table.razorpayPaymentId),
    paymentOrderIdx: index('payment_transactions_payment_order_id_idx').on(table.paymentOrderId),
    razorpayPaymentIdx: index('payment_transactions_razorpay_payment_id_idx').on(table.razorpayPaymentId),
    createdAtIdx: index('payment_transactions_created_at_idx').on(table.createdAt)
  })
);

export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    paymentTransactionId: uuid('payment_transaction_id').notNull().references(() => paymentTransactions.id, { onDelete: 'restrict' }),
    razorpayRefundId: text('razorpay_refund_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull(),
    approvalStatus: text('approval_status').notNull().default('pending'),
    reason: text('reason'),
    rejectionReason: text('rejection_reason'),
    retryCount: integer('retry_count').notNull().default(0),
    providerState: jsonb('provider_state').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('payment_refunds_tenant_id_idx').on(table.tenantId),
    tenantRazorpayRefundUnique: uniqueIndex('payment_refunds_tenant_razorpay_refund_unique').on(table.tenantId, table.razorpayRefundId),
    paymentTransactionIdx: index('payment_refunds_payment_transaction_id_idx').on(table.paymentTransactionId),
    razorpayRefundIdx: index('payment_refunds_razorpay_refund_id_idx').on(table.razorpayRefundId),
    createdAtIdx: index('payment_refunds_created_at_idx').on(table.createdAt)
  })
);

export const paymentLifecycleEvents = pgTable(
  'payment_lifecycle_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    paymentOrderId: uuid('payment_order_id').references(() => paymentOrders.id, { onDelete: 'cascade' }),
    paymentTransactionId: uuid('payment_transaction_id').references(() => paymentTransactions.id, { onDelete: 'cascade' }),
    paymentRefundId: uuid('payment_refund_id').references(() => paymentRefunds.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    requestId: text('request_id'),
    correlationId: text('correlation_id'),
    providerEventId: text('provider_event_id'),
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('payment_lifecycle_events_tenant_id_idx').on(table.tenantId),
    entityIdx: index('payment_lifecycle_events_entity_idx').on(table.entityType, table.entityId),
    paymentOrderIdx: index('payment_lifecycle_events_payment_order_id_idx').on(table.paymentOrderId),
    refundIdx: index('payment_lifecycle_events_payment_refund_id_idx').on(table.paymentRefundId),
    eventTypeIdx: index('payment_lifecycle_events_event_type_idx').on(table.eventType),
    tenantIdempotencyUnique: uniqueIndex('payment_lifecycle_events_tenant_idempotency_unique').on(table.tenantId, table.idempotencyKey),
    createdAtIdx: index('payment_lifecycle_events_created_at_idx').on(table.createdAt)
  })
);

export const refundReasonCatalog = pgTable(
  'refund_reason_catalog',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    category: text('category').notNull().default('customer_request'),
    isActive: integer('is_active').notNull().default(1),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantCodeUnique: uniqueIndex('refund_reason_catalog_tenant_code_unique').on(table.tenantId, table.code),
    tenantIdx: index('refund_reason_catalog_tenant_id_idx').on(table.tenantId)
  })
);

export const paymentOrdersRelations = relations(paymentOrders, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [paymentOrders.tenantId],
    references: [tenants.id]
  }),
  bookingOrder: one(bookingOrders, {
    fields: [paymentOrders.bookingOrderId],
    references: [bookingOrders.id]
  }),
  createdBy: one(users, {
    fields: [paymentOrders.createdBy],
    references: [users.id]
  }),
  transactions: many(paymentTransactions)
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [paymentTransactions.tenantId],
    references: [tenants.id]
  }),
  paymentOrder: one(paymentOrders, {
    fields: [paymentTransactions.paymentOrderId],
    references: [paymentOrders.id]
  }),
  refunds: many(paymentRefunds)
}));

export const paymentRefundsRelations = relations(paymentRefunds, ({ one }) => ({
  tenant: one(tenants, {
    fields: [paymentRefunds.tenantId],
    references: [tenants.id]
  }),
  transaction: one(paymentTransactions, {
    fields: [paymentRefunds.paymentTransactionId],
    references: [paymentTransactions.id]
  })
}));

export const reconciliationReports = pgTable(
  'reconciliation_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    paymentTransactionId: uuid('payment_transaction_id').references(() => paymentTransactions.id, { onDelete: 'set null' }),
    razorpayPaymentId: text('razorpay_payment_id'),
    status: text('status').notNull().default('open'),
    discrepancyType: text('discrepancy_type').notNull(),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('reconciliation_reports_tenant_id_idx').on(table.tenantId),
    transactionIdx: index('reconciliation_reports_transaction_id_idx').on(table.paymentTransactionId),
    razorpayPaymentIdx: index('reconciliation_reports_razorpay_payment_idx').on(table.razorpayPaymentId),
    discrepancyTypeIdx: index('reconciliation_reports_discrepancy_type_idx').on(table.discrepancyType),
    createdAtIdx: index('reconciliation_reports_created_at_idx').on(table.createdAt)
  })
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    razorpayEventId: text('razorpay_event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    status: text('status').notNull()
  },
  (table) => ({
    eventTypeIdx: index('payment_webhook_events_event_type_idx').on(table.eventType),
    statusIdx: index('payment_webhook_events_status_idx').on(table.status),
    receivedAtIdx: index('payment_webhook_events_received_at_idx').on(table.receivedAt)
  })
);

export const paymentAuditLogs = pgTable(
  'payment_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('payment_audit_logs_tenant_id_idx').on(table.tenantId),
    actorIdx: index('payment_audit_logs_actor_id_idx').on(table.actorId),
    entityIdx: index('payment_audit_logs_entity_idx').on(table.entityType, table.entityId),
    actionIdx: index('payment_audit_logs_action_idx').on(table.action),
    createdAtIdx: index('payment_audit_logs_created_at_idx').on(table.createdAt)
  })
);

export const paymentRiskEvents = pgTable(
  'payment_risk_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    score: integer('score').notNull(),
    reason: text('reason').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('payment_risk_events_tenant_id_idx').on(table.tenantId),
    userIdx: index('payment_risk_events_user_id_idx').on(table.userId),
    createdAtIdx: index('payment_risk_events_created_at_idx').on(table.createdAt)
  })
);

export const reconciliationReportsRelations = relations(reconciliationReports, ({ one }) => ({
  tenant: one(tenants, {
    fields: [reconciliationReports.tenantId],
    references: [tenants.id]
  }),
  transaction: one(paymentTransactions, {
    fields: [reconciliationReports.paymentTransactionId],
    references: [paymentTransactions.id]
  })
}));

export const paymentAuditLogsRelations = relations(paymentAuditLogs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [paymentAuditLogs.tenantId],
    references: [tenants.id]
  }),
  actor: one(users, {
    fields: [paymentAuditLogs.actorId],
    references: [users.id]
  })
}));

export const paymentRiskEventsRelations = relations(paymentRiskEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [paymentRiskEvents.tenantId],
    references: [tenants.id]
  }),
  user: one(users, {
    fields: [paymentRiskEvents.userId],
    references: [users.id]
  })
}));

export const paymentDisputes = pgTable(
  'payment_disputes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    paymentTransactionId: uuid('payment_transaction_id').notNull().references(() => paymentTransactions.id, { onDelete: 'restrict' }),
    razorpayDisputeId: text('razorpay_dispute_id'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('received'), // 'received', 'under_review', 'evidence_required', 'evidence_submitted', 'won', 'lost', 'reversed'
    reason: text('reason'),
    evidenceDeadline: timestamp('evidence_deadline', { withTimezone: true, mode: 'date' }),
    evidenceSubmission: jsonb('evidence_submission').notNull().default(sql`'{}'::jsonb`),
    gatewayResponse: jsonb('gateway_response').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('payment_disputes_tenant_id_idx').on(table.tenantId),
    transactionIdx: index('payment_disputes_transaction_id_idx').on(table.paymentTransactionId),
    razorpayDisputeIdx: index('payment_disputes_razorpay_dispute_id_idx').on(table.razorpayDisputeId),
    statusIdx: index('payment_disputes_status_idx').on(table.status),
    createdAtIdx: index('payment_disputes_created_at_idx').on(table.createdAt)
  })
);

export const paymentDisputeEvidence = pgTable(
  'payment_dispute_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    disputeId: uuid('dispute_id').notNull().references(() => paymentDisputes.id, { onDelete: 'cascade' }),
    documentUrl: text('document_url').notNull(),
    documentType: text('document_type').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('payment_dispute_evidence_tenant_id_idx').on(table.tenantId),
    disputeIdx: index('payment_dispute_evidence_dispute_id_idx').on(table.disputeId)
  })
);

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    type: text('type').notNull(), // 'coupon', 'cashback', 'promotional_credit'
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('active'), // 'active', 'expired', 'inactive'
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => ({
    tenantIdx: index('promotions_tenant_id_idx').on(table.tenantId),
    codeIdx: index('promotions_code_idx').on(table.code),
    tenantCodeUnique: uniqueIndex('promotions_tenant_code_unique').on(table.tenantId, table.code)
  })
);

export const paymentDisputesRelations = relations(paymentDisputes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [paymentDisputes.tenantId], references: [tenants.id] }),
  transaction: one(paymentTransactions, { fields: [paymentDisputes.paymentTransactionId], references: [paymentTransactions.id] }),
  evidence: many(paymentDisputeEvidence)
}));

export const paymentDisputeEvidenceRelations = relations(paymentDisputeEvidence, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentDisputeEvidence.tenantId], references: [tenants.id] }),
  dispute: one(paymentDisputes, { fields: [paymentDisputeEvidence.disputeId], references: [paymentDisputes.id] })
}));

export const promotionsRelations = relations(promotions, ({ one }) => ({
  tenant: one(tenants, { fields: [promotions.tenantId], references: [tenants.id] })
}));
