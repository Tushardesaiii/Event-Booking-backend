import type { InferSelectModel } from 'drizzle-orm';
import {
  paymentOrders,
  paymentTransactions,
  paymentRefunds,
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  organizerWallets,
  organizerWalletTransactions,
  withdrawalRequests,
  settlementRuns
} from '../../db/schema/index.js';
import type { CreateOrderInput, CaptureInput, RefundInput } from './schemas.js';

export type PaymentOrderRecord = InferSelectModel<typeof paymentOrders>;
export type PaymentTransactionRecord = InferSelectModel<typeof paymentTransactions>;
export type PaymentRefundRecord = InferSelectModel<typeof paymentRefunds>;

export type LedgerAccountRecord = InferSelectModel<typeof ledgerAccounts>;
export type LedgerTransactionRecord = InferSelectModel<typeof ledgerTransactions>;
export type LedgerEntryRecord = InferSelectModel<typeof ledgerEntries>;
export type OrganizerWalletRecord = InferSelectModel<typeof organizerWallets>;
export type OrganizerWalletTransactionRecord = InferSelectModel<typeof organizerWalletTransactions>;
export type WithdrawalRequestRecord = InferSelectModel<typeof withdrawalRequests>;
export type SettlementRunRecord = InferSelectModel<typeof settlementRuns>;

export type CreateOrderDTO = CreateOrderInput;
export type CaptureDTO = CaptureInput;
export type RefundDTO = RefundInput;
