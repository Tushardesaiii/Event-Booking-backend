import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { ledgerEntries, ledgerAccountBalances, ledgerAccounts, organizerWallets, organizerWalletTransactions, withdrawalRequests } from '../../../db/schema/ledger.js';
import { AccountRegistry } from '../accounting/registry.js';
import type { FinanceAccountType, LedgerAccountBalance } from '../types.js';

export const LedgerBalanceService = {
  /**
   * Resolves cached account balance or dynamically compiles it if missing
   */
  async getBalance(
    tenantId: string,
    accountType: FinanceAccountType,
    contextId?: string | null
  ): Promise<{ balance: string; debitBalance: string; creditBalance: string }> {
    const account = await AccountRegistry.resolveAccount(db, {
      tenantId,
      type: accountType,
      contextId
    });

    const [cache] = await db
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, account.id), eq(ledgerAccountBalances.tenantId, tenantId)))
      .limit(1);

    if (cache) {
      return {
        balance: cache.balance,
        debitBalance: cache.debitBalance,
        creditBalance: cache.creditBalance
      };
    }

    // If cache not present, perform a rebuild
    const rebuilt = await this.rebuildBalance(tenantId, account.id);
    return {
      balance: rebuilt.balance,
      debitBalance: rebuilt.debitBalance,
      creditBalance: rebuilt.creditBalance
    };
  },

  /**
   * Wipes and rebuilds the cached projection for a specific ledger account from scratch
   */
  async rebuildBalance(tenantId: string, accountId: string): Promise<LedgerAccountBalance> {
    return db.transaction(async (tx) => {
      // 1. Fetch entries
      const entries = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.accountId, accountId), eq(ledgerEntries.tenantId, tenantId)));

      let debitSum = 0;
      let creditSum = 0;

      for (const entry of entries) {
        const val = parseFloat(entry.amount);
        if (entry.direction === 'debit') {
          debitSum += val;
        } else {
          creditSum += val;
        }
      }

      const netBalance = creditSum - debitSum;

      const [existing] = await tx
        .select()
        .from(ledgerAccountBalances)
        .where(and(eq(ledgerAccountBalances.accountId, accountId), eq(ledgerAccountBalances.tenantId, tenantId)))
        .for('update')
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(ledgerAccountBalances)
          .set({
            balance: netBalance.toFixed(2),
            debitBalance: debitSum.toFixed(2),
            creditBalance: creditSum.toFixed(2),
            updatedAt: new Date()
          })
          .where(eq(ledgerAccountBalances.id, existing.id))
          .returning();
        return updated;
      } else {
        const [inserted] = await tx
          .insert(ledgerAccountBalances)
          .values({
            tenantId,
            accountId,
            balance: netBalance.toFixed(2),
            debitBalance: debitSum.toFixed(2),
            creditBalance: creditSum.toFixed(2)
          })
          .returning();
        return inserted;
      }
    });
  },

  /**
   * Rebuilds balance projections for all ledger accounts under a tenant
   */
  async rebuildAllTenantBalances(tenantId: string): Promise<void> {
    const accounts = await db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, tenantId));

    for (const acc of accounts) {
      await this.rebuildBalance(tenantId, acc.id);
    }
  },

  /**
   * Rebuilds available, pending, and withdrawn balances for an organizer wallet from database records
   */
  async rebuildOrganizerWallet(tenantId: string, organizerId: string): Promise<any> {
    return db.transaction(async (tx) => {
      const availAcc = await AccountRegistry.resolveAccount(tx, {
        tenantId,
        type: 'ORGANIZER_BALANCE',
        contextId: organizerId
      });

      const availEntries = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.accountId, availAcc.id), eq(ledgerEntries.tenantId, tenantId)));

      let debitSum = 0;
      let creditSum = 0;
      for (const entry of availEntries) {
        const val = parseFloat(entry.amount);
        if (entry.direction === 'debit') debitSum += val;
        else creditSum += val;
      }
      const recalculatedAvailable = creditSum - debitSum;

      const pendingCredits = await tx
        .select()
        .from(organizerWalletTransactions)
        .where(
          and(
            eq(organizerWalletTransactions.organizerId, organizerId),
            eq(organizerWalletTransactions.tenantId, tenantId),
            eq(organizerWalletTransactions.type, 'credit'),
            eq(organizerWalletTransactions.status, 'pending')
          )
        );

      let recalculatedPending = 0;
      for (const t of pendingCredits) {
        recalculatedPending += parseFloat(t.amount);
      }

      const withdrawals = await tx
        .select()
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.organizerId, organizerId),
            eq(withdrawalRequests.tenantId, tenantId),
            eq(withdrawalRequests.status, 'completed')
          )
        );

      let recalculatedWithdrawn = 0;
      for (const w of withdrawals) {
        recalculatedWithdrawn += parseFloat(w.amount);
      }

      const [wallet] = await tx
        .select()
        .from(organizerWallets)
        .where(and(eq(organizerWallets.organizerId, organizerId), eq(organizerWallets.tenantId, tenantId)))
        .for('update')
        .limit(1);

      if (wallet) {
        const [updated] = await tx
          .update(organizerWallets)
          .set({
            availableBalance: recalculatedAvailable.toFixed(2),
            pendingBalance: recalculatedPending.toFixed(2),
            withdrawnBalance: recalculatedWithdrawn.toFixed(2),
            updatedAt: new Date()
          })
          .where(eq(organizerWallets.id, wallet.id))
          .returning();
        return updated;
      } else {
        const [inserted] = await tx
          .insert(organizerWallets)
          .values({
            tenantId,
            organizerId,
            availableBalance: recalculatedAvailable.toFixed(2),
            pendingBalance: recalculatedPending.toFixed(2),
            withdrawnBalance: recalculatedWithdrawn.toFixed(2)
          })
          .returning();
        return inserted;
      }
    });
  }
};
