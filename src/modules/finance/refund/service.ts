import { AccountingRuleEngine } from '../accounting/rule-engine.js';
import type { PostingReceipt } from '../types.js';

export const RefundPostingService = {
  /**
   * Post refund reversal entries to general ledger
   */
  async postRefund(params: {
    tenantId: string;
    refundId: string;
    refundAmount: number; // in minor units
    isSettled: boolean;
    organizerId?: string;
    platformFeeRefund?: number; // in minor units
    taxRefund?: number; // in minor units
    netOrganizerRefund?: number; // in minor units
    idempotencyKey: string;
    userId?: string;
  }, tx?: any): Promise<PostingReceipt> {
    return AccountingRuleEngine.postRefund(params, tx);
  }
};
