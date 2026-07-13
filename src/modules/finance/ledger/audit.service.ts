import { createHash } from 'node:crypto';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { ledgerTransactions, ledgerEntries } from '../../../db/schema/ledger.js';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export const LedgerAuditService = {
  /**
   * Verifies the cryptographic chain integrity for all ledger transactions of a given tenant.
   * Walks the chain from genesis and recalculates SHA-256 hashes to detect tampering.
   */
  async verifyChainIntegrity(tenantId: string): Promise<{ healthy: boolean; verifiedTransactionsCount: number; errors: string[] }> {
    const errors: string[] = [];
    
    // Fetch all transactions in chronological order of creation
    const txs = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.tenantId, tenantId))
      .orderBy(asc(ledgerTransactions.createdAt));

    let expectedPrevHash = GENESIS_HASH;
    let verifiedCount = 0;

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      verifiedCount++;

      // Verify the previous hash matches our expected chain position
      if (tx.previousHash !== expectedPrevHash) {
        errors.push(
          `Cryptographic chain broken at transaction sequence ${i} (ID: ${tx.id}). ` +
          `Expected previous_hash: ${expectedPrevHash}, Database contains: ${tx.previousHash}`
        );
      }

      // Reconstruct transaction details for hash calculation
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.ledgerTransactionId, tx.id));

      // Resolve dynamic ledger accounts names/identifiers mapped to numbers
      const resolvedEntries = entries.map((e) => ({
        accountId: e.accountId,
        direction: e.direction,
        amount: Math.round(parseFloat(e.amount) * 100)
      }));

      const txnDetailsString = JSON.stringify({
        tenantId: tx.tenantId,
        transactionType: tx.transactionType,
        amount: Math.round(parseFloat(tx.amount) * 100),
        currency: tx.currency,
        referenceType: tx.referenceType,
        referenceId: tx.referenceId,
        entries: resolvedEntries
      });

      const computedHash = createHash('sha256')
        .update(expectedPrevHash + txnDetailsString)
        .digest('hex');

      if (tx.currentHash !== computedHash) {
        errors.push(
          `Tampering detected! Hash signature mismatch for transaction ID: ${tx.id}. ` +
          `Computed hash: ${computedHash}, Database contains: ${tx.currentHash}`
        );
      }

      // Chain forward: set next expected previous hash to the current transaction's database hash
      expectedPrevHash = tx.currentHash || '';
    }

    return {
      healthy: errors.length === 0,
      verifiedTransactionsCount: verifiedCount,
      errors
    };
  }
};
