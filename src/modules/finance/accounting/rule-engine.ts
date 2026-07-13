import { LedgerTransactionBuilder } from '../posting-engine/builder.js';
import { JournalTemplates } from '../journal/templates.js';
import type { PostingReceipt } from '../types.js';

export const AccountingRuleEngine = {
  /**
   * Translates a business payment captured event into a general ledger posting
   */
  async postPaymentCapture(params: {
    tenantId: string;
    bookingId: string;
    paymentId: string;
    amount: number; // in minor units
    currency: string;
    idempotencyKey: string;
    userId?: string;
    ipAddress?: string;
    requestId?: string;
  }, tx?: any): Promise<PostingReceipt> {
    const entries = JournalTemplates.paymentCapture({
      amount: params.amount,
      currency: params.currency
    });

    return new LedgerTransactionBuilder()
      .organization(params.tenantId)
      .type('TICKET_PURCHASE_CAPTURE')
      .totalAmount(params.amount)
      .currencyCode(params.currency)
      .reference('payment_transaction', params.paymentId)
      .idempotency(params.idempotencyKey)
      .actor(params.userId)
      .context(params.ipAddress, params.requestId)
      .debit(entries[0].accountType, entries[0].amount, entries[0].accountName, entries[0].metadata)
      .credit(entries[1].accountType, entries[1].amount, entries[1].accountName, entries[1].metadata)
      .post(tx);
  },

  /**
   * Translates a settlement completion event into balanced journal split postings
   */
  async postSettlement(params: {
    tenantId: string;
    settlementRunId: string;
    organizerId: string;
    grossAmount: number; // minor units
    platformFee: number; // minor units
    tax: number; // minor units
    netOrganizerShare: number; // minor units
    idempotencyKey: string;
    userId?: string;
  }, tx?: any): Promise<PostingReceipt> {
    const entries = JournalTemplates.settlement({
      grossAmount: params.grossAmount,
      platformFee: params.platformFee,
      tax: params.tax,
      netOrganizerShare: params.netOrganizerShare,
      organizerId: params.organizerId
    });

    const builder = new LedgerTransactionBuilder()
      .organization(params.tenantId)
      .type('ORGANIZER_SETTLEMENT')
      .totalAmount(params.grossAmount)
      .currencyCode('INR')
      .reference('settlement_run', params.settlementRunId)
      .idempotency(params.idempotencyKey)
      .actor(params.userId);

    // Dynamic addition of debit and credits
    for (const entry of entries) {
      if (entry.direction === 'debit') {
        builder.debit(entry.accountType, entry.amount, entry.accountName, entry.metadata);
      } else {
        builder.credit(entry.accountType, entry.amount, entry.accountName, entry.metadata);
      }
    }

    return builder.post(tx);
  },

  /**
   * Translates a refund processed event (pre-settled or post-settled) into ledger reversals
   */
  async postRefund(params: {
    tenantId: string;
    refundId: string;
    refundAmount: number; // minor units
    isSettled: boolean;
    organizerId?: string;
    platformFeeRefund?: number; // minor units
    taxRefund?: number; // minor units
    netOrganizerRefund?: number; // minor units
    idempotencyKey: string;
    userId?: string;
  }, tx?: any): Promise<PostingReceipt> {
    const entries = JournalTemplates.refund({
      refundAmount: params.refundAmount,
      isSettled: params.isSettled,
      organizerId: params.organizerId,
      platformFeeRefund: params.platformFeeRefund,
      taxRefund: params.taxRefund,
      netOrganizerRefund: params.netOrganizerRefund
    });

    const transactionType = params.isSettled ? 'TICKET_PURCHASE_REFUND_SETTLED' : 'TICKET_PURCHASE_REFUND_ESCROW';
    const totalAmount = params.isSettled ? params.refundAmount : params.refundAmount;

    const builder = new LedgerTransactionBuilder()
      .organization(params.tenantId)
      .type(transactionType)
      .totalAmount(totalAmount)
      .currencyCode('INR')
      .reference('payment_refund', params.refundId)
      .idempotency(params.idempotencyKey)
      .actor(params.userId);

    for (const entry of entries) {
      if (entry.direction === 'debit') {
        builder.debit(entry.accountType, entry.amount, entry.accountName, entry.metadata);
      } else {
        builder.credit(entry.accountType, entry.amount, entry.accountName, entry.metadata);
      }
    }

    return builder.post(tx);
  },

  /**
   * Translates a withdrawal completed event into balanced entries
   */
  async postWithdrawal(params: {
    tenantId: string;
    withdrawalRequestId: string;
    organizerId: string;
    amount: number; // minor units
    idempotencyKey: string;
    userId?: string;
  }, tx?: any): Promise<PostingReceipt> {
    const entries = JournalTemplates.withdrawal({
      amount: params.amount,
      organizerId: params.organizerId
    });

    return new LedgerTransactionBuilder()
      .organization(params.tenantId)
      .type('ORGANIZER_WITHDRAWAL')
      .totalAmount(params.amount)
      .currencyCode('INR')
      .reference('withdrawal_request', params.withdrawalRequestId)
      .idempotency(params.idempotencyKey)
      .actor(params.userId)
      .debit(entries[0].accountType, entries[0].amount, entries[0].accountName, entries[0].metadata)
      .credit(entries[1].accountType, entries[1].amount, entries[1].accountName, entries[1].metadata)
      .post(tx);
  }
};
