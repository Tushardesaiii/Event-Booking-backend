import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { ledgerAccounts, ledgerTransactions, ledgerEntries } from '../../../db/schema/ledger.js';
import { financeRepository } from '../repository.js';
import type { LedgerAccount, LedgerTransaction, LedgerEntry, FinanceAccountType } from '../types.js';

export const LedgerService = {
  /**
   * Resolve an account by type
   */
  async resolveAccount(
    tx: any,
    tenantId: string,
    type: FinanceAccountType,
    contextId?: string | null
  ): Promise<LedgerAccount> {
    const connection = tx || db;
    // Map organizer ID context or similar
    let name = type.toString();
    if (contextId) {
      name = `${type.toString()}: ${contextId}`;
    }
    return financeRepository.getOrCreateAccount(connection, {
      tenantId,
      type,
      name
    });
  },

  /**
   * Find account by ID
   */
  async findAccountById(tenantId: string, accountId: string): Promise<LedgerAccount | null> {
    const [record] = await db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.tenantId, tenantId)))
      .limit(1);
    return record ?? null;
  },

  /**
   * List all accounts for a tenant
   */
  async listAccounts(tenantId: string, page = 1, limit = 50): Promise<LedgerAccount[]> {
    const offset = (page - 1) * limit;
    return db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, tenantId))
      .limit(limit)
      .offset(offset);
  },

  /**
   * List transactions with entry details
   */
  async listTransactions(tenantId: string, page = 1, limit = 50): Promise<Array<LedgerTransaction & { entries: LedgerEntry[] }>> {
    const offset = (page - 1) * limit;
    const txs = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.tenantId, tenantId))
      .orderBy(desc(ledgerTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    const result = [];
    for (const tx of txs) {
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.ledgerTransactionId, tx.id));
      result.push({
        ...tx,
        entries
      });
    }
    return result;
  }
};
