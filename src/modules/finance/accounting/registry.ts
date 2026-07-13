import { db } from '../../../db/client.js';
import { financeRepository } from '../repository.js';
import type { FinanceAccountType, LedgerAccount } from '../types.js';

export const AccountRegistry = {
  /**
   * Resolves a ledger account by its logical type and context ID.
   * Auto-creates the account if it doesn't already exist.
   */
  async resolveAccount(
    tx: any,
    params: {
      tenantId: string;
      type: FinanceAccountType;
      contextId?: string | null;
      currency?: string;
    }
  ): Promise<LedgerAccount> {
    const connection = tx || db;
    const currency = params.currency ?? 'INR';

    // Generate clean account names based on the logical type
    let name = '';
    switch (params.type) {
      case 'PLATFORM_CASH':
      case 'PAYMENT_GATEWAY_CLEARING':
        name = 'Platform Cash Clearing';
        break;
      case 'ESCROW':
      case 'PLATFORM_ESCROW':
        name = 'Platform Escrow Custody';
        break;
      case 'ORGANIZER_PENDING':
        if (!params.contextId) throw new Error('Organizer ID is required to resolve ORGANIZER_PENDING');
        name = `Organizer Pending: ${params.contextId}`;
        break;
      case 'ORGANIZER_AVAILABLE':
      case 'ORGANIZER_BALANCE':
        if (!params.contextId) throw new Error('Organizer ID is required to resolve ORGANIZER_AVAILABLE');
        name = `Organizer Available: ${params.contextId}`;
        break;
      case 'ORGANIZER_PAYABLE':
        if (!params.contextId) throw new Error('Organizer ID is required to resolve ORGANIZER_PAYABLE');
        name = `Organizer Payable: ${params.contextId}`;
        break;
      case 'CUSTOMER_CASH':
        if (!params.contextId) throw new Error('Customer ID is required to resolve CUSTOMER_CASH');
        name = `Customer Cash: ${params.contextId}`;
        break;
      case 'CUSTOMER_LIABILITY':
        if (!params.contextId) throw new Error('Customer ID is required to resolve CUSTOMER_LIABILITY');
        name = `Customer Liability: ${params.contextId}`;
        break;
      case 'PLATFORM_REVENUE':
      case 'PLATFORM_FEE_REVENUE':
        name = 'Platform Commission Revenue';
        break;
      case 'GATEWAY_FEE_EXPENSE':
        name = 'Gateway Fee Expense';
        break;
      case 'TAX_PAYABLE':
        name = 'Tax Liabilities (GST/VAT)';
        break;
      case 'REFUND_LIABILITY':
      case 'CUSTOMER_REFUNDS':
        name = 'Customer Refund Liability';
        break;
      case 'CHARGEBACK_RESERVE':
        name = 'Chargeback Reserve Fund';
        break;
      case 'RESERVE':
        name = 'Platform Cash Reserves';
        break;
      case 'SETTLEMENT_CLEARING':
        name = 'Settlement Batch Clearing';
        break;
      case 'WITHDRAWAL_CLEARING':
        name = 'Withdrawal Payout Clearing';
        break;
      case 'SYSTEM_ADJUSTMENT':
        name = 'System Adjustment Account';
        break;
      case 'FRAUD_RESERVE':
        name = 'Fraud Hold Reserve';
        break;
      case 'SUSPENSE_ACCOUNT':
      default:
        name = 'Suspense Hold Account';
        break;
    }

    return financeRepository.getOrCreateAccount(connection, {
      tenantId: params.tenantId,
      type: params.type,
      name,
      currency,
      precision: 2,
      minorUnit: 100
    });
  }
};
