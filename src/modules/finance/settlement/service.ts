import { AccountingRuleEngine } from '../accounting/rule-engine.js';
import type { PostingReceipt } from '../types.js';

export const SettlementPostingService = {
  /**
   * Post settlement splits to general ledger
   */
  async postSettlement(params: {
    tenantId: string;
    settlementRunId: string;
    organizerId: string;
    grossAmount: number; // in minor units
    platformFee: number; // in minor units
    tax: number; // in minor units
    netOrganizerShare: number; // in minor units
    idempotencyKey: string;
    userId?: string;
  }, tx?: any): Promise<PostingReceipt> {
    return AccountingRuleEngine.postSettlement(params, tx);
  }
};
