import { AccountingRuleEngine } from '../accounting/rule-engine.js';
import type { PostingReceipt } from '../types.js';

export const WithdrawalPostingService = {
  /**
   * Post withdrawal entries to general ledger
   */
  async postWithdrawal(params: {
    tenantId: string;
    withdrawalRequestId: string;
    organizerId: string;
    amount: number; // in minor units
    idempotencyKey: string;
    userId?: string;
  }, tx?: any): Promise<PostingReceipt> {
    return AccountingRuleEngine.postWithdrawal(params, tx);
  }
};
