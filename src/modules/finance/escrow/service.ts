import { AccountingRuleEngine } from '../accounting/rule-engine.js';
import type { PostingReceipt } from '../types.js';

export const EscrowPostingService = {
  /**
   * Post a customer payment capture into the general ledger
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
    return AccountingRuleEngine.postPaymentCapture(params, tx);
  }
};
