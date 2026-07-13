import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { ledgerAccounts, ledgerTransactions, ledgerEntries, ledgerAccountBalances } from '../../../db/schema/ledger.js';
import { AccountRegistry } from '../accounting/registry.js';
import type { FinanceAccountType } from '../types.js';

export const LedgerReportingService = {
  /**
   * Generates a Trial Balance report: listing all accounts with debit/credit aggregates.
   * Debits must equal credits globally.
   */
  async getTrialBalance(tenantId: string): Promise<any> {
    const balances = await db
      .select({
        accountId: ledgerAccountBalances.accountId,
        accountName: ledgerAccounts.name,
        accountType: ledgerAccounts.type,
        debitSum: ledgerAccountBalances.debitBalance,
        creditSum: ledgerAccountBalances.creditBalance,
        netBalance: ledgerAccountBalances.balance
      })
      .from(ledgerAccountBalances)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerAccountBalances.accountId))
      .where(eq(ledgerAccountBalances.tenantId, tenantId));

    let totalDebits = 0;
    let totalCredits = 0;

    for (const bal of balances) {
      totalDebits += parseFloat(bal.debitSum);
      totalCredits += parseFloat(bal.creditSum);
    }

    return {
      timestamp: new Date(),
      tenantId,
      totalDebits: totalDebits.toFixed(2),
      totalCredits: totalCredits.toFixed(2),
      balanced: Math.abs(totalDebits - totalCredits) < 0.01,
      accounts: balances
    };
  },

  /**
   * Generates General Ledger report
   */
  async getGeneralLedger(tenantId: string): Promise<any> {
    const accounts = await db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, tenantId));

    const result = [];
    for (const acc of accounts) {
      const balanceRow = await db
        .select()
        .from(ledgerAccountBalances)
        .where(and(eq(ledgerAccountBalances.accountId, acc.id), eq(ledgerAccountBalances.tenantId, tenantId)))
        .limit(1)
        .then(res => res[0] ?? null);

      result.push({
        ...acc,
        debitBalance: balanceRow?.debitBalance ?? '0.00',
        creditBalance: balanceRow?.creditBalance ?? '0.00',
        balance: balanceRow?.balance ?? '0.00'
      });
    }

    return {
      tenantId,
      timestamp: new Date(),
      accounts: result
    };
  },

  /**
   * Generates Account Statement for a single account
   */
  async getAccountStatement(tenantId: string, accountId: string, page = 1, limit = 50): Promise<any> {
    const [account] = await db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.tenantId, tenantId)))
      .limit(1);

    if (!account) {
      throw new Error(`Account with ID ${accountId} not found`);
    }

    const offset = (page - 1) * limit;

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.accountId, accountId), eq(ledgerEntries.tenantId, tenantId)))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limit)
      .offset(offset);

    const balanceRow = await db
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, accountId), eq(ledgerAccountBalances.tenantId, tenantId)))
      .limit(1)
      .then(res => res[0] ?? null);

    return {
      account,
      currentBalance: balanceRow?.balance ?? '0.00',
      debitSum: balanceRow?.debitBalance ?? '0.00',
      creditSum: balanceRow?.creditBalance ?? '0.00',
      entries,
      meta: { page, limit }
    };
  },

  /**
   * Generates statement of organizer payouts & available balances
   */
  async getOrganizerStatement(tenantId: string, organizerId: string, page = 1, limit = 50): Promise<any> {
    const acc = await AccountRegistry.resolveAccount(db, {
      tenantId,
      type: 'ORGANIZER_BALANCE',
      contextId: organizerId
    });

    return this.getAccountStatement(tenantId, acc.id, page, limit);
  },

  /**
   * Generates Escrow summary report
   */
  async getEscrowReport(tenantId: string): Promise<any> {
    const acc = await AccountRegistry.resolveAccount(db, {
      tenantId,
      type: 'PLATFORM_ESCROW'
    });

    const balanceRow = await db
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, acc.id), eq(ledgerAccountBalances.tenantId, tenantId)))
      .limit(1)
      .then(res => res[0] ?? null);

    return {
      accountId: acc.id,
      accountName: acc.name,
      currency: acc.currency,
      totalFundsHeld: balanceRow?.balance ?? '0.00',
      debitVolume: balanceRow?.debitBalance ?? '0.00',
      creditVolume: balanceRow?.creditBalance ?? '0.00',
      timestamp: new Date()
    };
  },

  /**
   * Platform Fee and commission revenue report
   */
  async getPlatformRevenueReport(tenantId: string): Promise<any> {
    const acc = await AccountRegistry.resolveAccount(db, {
      tenantId,
      type: 'PLATFORM_REVENUE'
    });

    const balanceRow = await db
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, acc.id), eq(ledgerAccountBalances.tenantId, tenantId)))
      .limit(1)
      .then(res => res[0] ?? null);

    return {
      accountId: acc.id,
      totalRevenue: balanceRow?.balance ?? '0.00',
      currency: acc.currency,
      timestamp: new Date()
    };
  },

  /**
   * Tax collected report
   */
  async getTaxReport(tenantId: string): Promise<any> {
    const acc = await AccountRegistry.resolveAccount(db, {
      tenantId,
      type: 'TAX_PAYABLE'
    });

    const balanceRow = await db
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, acc.id), eq(ledgerAccountBalances.tenantId, tenantId)))
      .limit(1)
      .then(res => res[0] ?? null);

    return {
      accountId: acc.id,
      totalTaxLiabilities: balanceRow?.balance ?? '0.00',
      currency: acc.currency,
      timestamp: new Date()
    };
  }
};
