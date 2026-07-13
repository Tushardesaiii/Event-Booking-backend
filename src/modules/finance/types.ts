import type { InferSelectModel } from 'drizzle-orm';
import {
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  ledgerSnapshots,
  ledgerAccountBalances,
  ledgerAuditLogs,
  ledgerIdempotencyKeys,
  ledgerEvents
} from '../../db/schema/ledger.js';

export type LedgerAccount = InferSelectModel<typeof ledgerAccounts>;
export type LedgerTransaction = InferSelectModel<typeof ledgerTransactions>;
export type LedgerEntry = InferSelectModel<typeof ledgerEntries>;
export type LedgerSnapshot = InferSelectModel<typeof ledgerSnapshots>;
export type LedgerAccountBalance = InferSelectModel<typeof ledgerAccountBalances>;
export type LedgerAuditLog = InferSelectModel<typeof ledgerAuditLogs>;
export type LedgerIdempotencyKey = InferSelectModel<typeof ledgerIdempotencyKeys>;
export type LedgerEvent = InferSelectModel<typeof ledgerEvents>;

// Financial State Machine Lifecycles
export type PaymentState = 'created' | 'pending' | 'authorized' | 'partially_captured' | 'captured' | 'cancelled' | 'expired' | 'partially_refunded' | 'refunded' | 'escrowed' | 'settled' | 'withdrawn' | 'closed' | 'failed';
export type RefundState = 'requested' | 'pending_approval' | 'approved' | 'rejected' | 'processing' | 'retry' | 'processed' | 'reversed' | 'failed';
export type WithdrawalState = 'queued' | 'pending' | 'approved' | 'processing' | 'retry' | 'completed' | 'failed' | 'reversed' | 'rejected' | 'cancelled';
export type SettlementState = 'scheduled' | 'pending_approval' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'retry' | 'discrepancies_found';

export interface PaymentStateTransition {
  from: PaymentState;
  to: PaymentState;
}

// Registry Account Types
export type FinanceAccountType =
  | 'PLATFORM_CASH'
  | 'CUSTOMER_CASH'
  | 'CUSTOMER_LIABILITY'
  | 'ESCROW'
  | 'ORGANIZER_PENDING'
  | 'ORGANIZER_AVAILABLE'
  | 'ORGANIZER_PAYABLE'
  | 'PLATFORM_FEE_REVENUE'
  | 'GATEWAY_FEE_EXPENSE'
  | 'TAX_PAYABLE'
  | 'REFUND_LIABILITY'
  | 'CHARGEBACK_RESERVE'
  | 'RESERVE'
  | 'SETTLEMENT_CLEARING'
  | 'WITHDRAWAL_CLEARING'
  | 'SYSTEM_ADJUSTMENT'
  | 'FRAUD_RESERVE'
  | 'SUSPENSE_ACCOUNT'
  // Backward compatibility types
  | 'PLATFORM_ESCROW'
  | 'PLATFORM_REVENUE'
  | 'ORGANIZER_BALANCE'
  | 'CUSTOMER_REFUNDS'
  | 'PAYMENT_GATEWAY_CLEARING';

export interface EntryInput {
  accountType: FinanceAccountType;
  accountName: string;
  amount: number; // in minor units
  direction: 'debit' | 'credit';
  metadata?: Record<string, any>;
}

export interface TransactionInput {
  tenantId: string;
  transactionType: string;
  amount: number; // in minor units
  currency: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  razorpayPaymentId?: string | null;
  bookingId?: string | null;
  withdrawalId?: string | null;
  refundId?: string | null;
  entries: EntryInput[];
  userId?: string;
  ipAddress?: string;
  requestId?: string;
}

export interface PostingReceipt {
  success: boolean;
  transactionId: string;
  transactionHash: string;
  entriesCount: number;
  idempotencyKey: string;
}

export interface VerificationReport {
  healthy: boolean;
  timestamp: Date;
  errors: string[];
}
