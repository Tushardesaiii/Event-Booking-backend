import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { ledgerEvents } from '../../../db/schema/ledger.js';
import { cacheService } from '../../../lib/cache.js';
import { logger } from '../../../lib/logger.js';
import { qstashService } from '../../../lib/qstash.js';
import { env } from '../../../config/env.js';
import { financeRepository } from '../repository.js';
import { AccountRegistry } from '../accounting/registry.js';
import type { TransactionInput, PostingReceipt, LedgerTransaction } from '../types.js';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export const LedgerPostingEngine = {
  /**
   * Posts a balanced double-entry transaction to the ledger.
   * Ensures absolute transactional integrity, concurrency control, outbox event generation, and audit trail locking.
   */
  async postTransaction(externalTx: any, input: TransactionInput): Promise<PostingReceipt> {
    const lockKey = `finance:ledger:lock:${input.tenantId}:${input.idempotencyKey}`;
    
    // 1. Acquire Redis Distributed Lock for cross-process concurrency safety
    const lockAcquired = await cacheService.lock(lockKey, 10);
    if (!lockAcquired) {
      throw new Error(`Concurrency Lock could not be acquired for key: ${input.idempotencyKey}. Operation is already in progress.`);
    }

    try {
      // 2. Check DB Idempotency Key
      const existingKey = await financeRepository.findIdempotencyKey(externalTx || db, input.tenantId, input.idempotencyKey);
      if (existingKey) {
        if (existingKey.status === 'completed') {
          logger.info('[LedgerPostingEngine] Idempotency match found. Returning cached posting receipt.', {
            key: input.idempotencyKey
          });
          return existingKey.responsePayload as PostingReceipt;
        }
        if (existingKey.status === 'pending') {
          throw new Error(`Idempotency key ${input.idempotencyKey} is already processing in another process.`);
        }
        // If failed, we can retry posting
      }

      // Create a pending idempotency log if it doesn't exist
      if (!existingKey) {
        await financeRepository.createIdempotencyKey(externalTx || db, {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
          razorpayPaymentId: input.razorpayPaymentId ?? (input.referenceType === 'payment_transaction' ? input.referenceId : null),
          bookingId: input.bookingId ?? (input.referenceType === 'booking_order' ? input.referenceId : null),
          withdrawalId: input.withdrawalId ?? (input.referenceType === 'withdrawal_request' ? input.referenceId : null),
          refundId: input.refundId ?? (input.referenceType === 'payment_refund' ? input.referenceId : null),
          status: 'pending'
        });
      }

      // 3. Process inside DB Transaction
      const postingTxn = async (tx: any) => {
        // DB lock to synchronize threads
        const dbLockAcquired = await financeRepository.acquireDbLock(tx, input.tenantId, input.idempotencyKey, 15);
        if (!dbLockAcquired) {
          throw new Error('Database thread lock acquisition failed. Parallel process holding transaction.');
        }

        try {
          // Resolve accounts dynamically via AccountRegistry
          const resolvedEntries = [];
          for (const entry of input.entries) {
            const contextId = entry.metadata?.organizerId || entry.metadata?.customerId || null;
            const account = await AccountRegistry.resolveAccount(tx, {
              tenantId: input.tenantId,
              type: entry.accountType,
              contextId,
              currency: input.currency
            });

            // Active validation: check matching currencies
            if (account.currency.toUpperCase() !== input.currency.toUpperCase()) {
              throw new Error(`Currency mismatch. Account ${account.name} operates in ${account.currency}, transaction expects ${input.currency}`);
            }

            resolvedEntries.push({
              accountId: account.id,
              accountName: account.name,
              amount: entry.amount,
              direction: entry.direction,
              metadata: entry.metadata
            });
          }

          // 4. Cryptographic Chaining.
          // Serialize chain appends per tenant BEFORE reading the head, so two
          // concurrent postings for the same tenant cannot both read the same
          // previousHash and fork the chain.
          await financeRepository.acquireTenantLedgerChainLock(tx, input.tenantId);
          const latestTx = await financeRepository.getLatestTransaction(tx, input.tenantId);
          const previousHash = latestTx ? latestTx.currentHash : GENESIS_HASH;

          // Compute Hash = SHA-256(previousHash + txnDetails)
          const txnDetailsString = JSON.stringify({
            tenantId: input.tenantId,
            transactionType: input.transactionType,
            amount: input.amount,
            currency: input.currency,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            entries: resolvedEntries.map(e => ({ accountId: e.accountId, direction: e.direction, amount: e.amount }))
          });

          const currentHash = createHash('sha256')
            .update((previousHash || '') + txnDetailsString)
            .digest('hex');

          // Decimal string representations
          const decimalAmount = (input.amount / 100).toFixed(2);

          // 5. Insert Ledger Transaction & Entries
          const ledgerTxRecord = await financeRepository.createTransaction(tx, {
            tenantId: input.tenantId,
            transactionType: input.transactionType,
            amount: decimalAmount,
            currency: input.currency,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            previousHash,
            currentHash
          });

          const dbEntries = await financeRepository.createEntries(
            tx,
            resolvedEntries.map((e) => ({
              tenantId: input.tenantId,
              accountId: e.accountId,
              ledgerTransactionId: ledgerTxRecord.id,
              amount: (e.amount / 100).toFixed(2),
              direction: e.direction,
              referenceType: input.referenceType,
              referenceId: input.referenceId,
              metadata: e.metadata
            }))
          );

          // 6. Update Active Projections (running balances) inside the transaction
          for (const e of resolvedEntries) {
            await financeRepository.updateRunningBalance(tx, e.accountId, input.tenantId, e.amount, e.direction);
          }

          const postingReceipt: PostingReceipt = {
            success: true,
            transactionId: ledgerTxRecord.id,
            transactionHash: currentHash,
            entriesCount: dbEntries.length,
            idempotencyKey: input.idempotencyKey
          };

          // 7. Write to Audit Log
          await financeRepository.createAuditLog(tx, {
            tenantId: input.tenantId,
            userId: input.userId,
            action: 'ledger_post',
            entityType: 'ledger_transaction',
            entityId: ledgerTxRecord.id,
            ipAddress: input.ipAddress,
            requestId: input.requestId,
            source: 'posting_engine',
            reference: `${input.referenceType}:${input.referenceId}`,
            afterState: postingReceipt,
            transactionHash: currentHash,
            metadata: { idempotencyKey: input.idempotencyKey }
          });

          // 8. Transactional Outbox Pattern: Insert Event
          const outboxEvent = await financeRepository.createEvent(tx, {
            tenantId: input.tenantId,
            eventType: 'LedgerTransactionPosted',
            payload: {
              transactionId: ledgerTxRecord.id,
              transactionType: input.transactionType,
              amount: decimalAmount,
              currency: input.currency,
              referenceType: input.referenceType,
              referenceId: input.referenceId,
              entries: resolvedEntries,
              receipt: postingReceipt
            }
          });

          // Save final completed response in the idempotency table
          await financeRepository.updateIdempotencyKey(tx, input.tenantId, input.idempotencyKey, {
            status: 'completed',
            responsePayload: postingReceipt
          });

          // Set immediate async microtask trigger to deliver outbox events to QStash asynchronously
          // (We execute this after the transaction commits to avoid holding locks)
          setTimeout(async () => {
            try {
              await LedgerPostingEngine.publishOutboxEvent(outboxEvent.id);
            } catch (err: any) {
              logger.error('[LedgerPostingEngine] Failed asynchronously publishing event to QStash', {
                eventId: outboxEvent.id,
                error: err.message
              });
            }
          }, 0);

          return postingReceipt;
        } finally {
          // Release DB locking thread key
          await financeRepository.releaseDbLock(tx, input.tenantId, input.idempotencyKey);
        }
      };

      // Bounded retry for transient high-concurrency faults. When many captures
      // post for the same tenant at once, the first-time creation of shared
      // ledger accounts/balance rows and the linear hash chain can race, surfacing
      // as serialization failures, deadlocks, unique violations or aborted
      // transactions. Retrying re-reads the now-committed rows and completes
      // cleanly, preserving exactly-once posting (idempotency key is unchanged).
      const isTransientFault = (e: any) => {
        const code = e?.code || e?.cause?.code || '';
        const msg = String(e?.message || '');
        return ['40001', '40P01', '23505', '25P02', '55P03'].includes(code) ||
          /deadlock|could not serialize|current transaction is aborted|duplicate key value/i.test(msg);
      };

      let receipt: PostingReceipt | undefined;
      const maxPostingAttempts = 6;
      for (let attempt = 1; ; attempt++) {
        try {
          receipt = await db.transaction(postingTxn);
          break;
        } catch (txErr: any) {
          if (isTransientFault(txErr) && attempt < maxPostingAttempts) {
            logger.warn('[LedgerPostingEngine] Transient posting fault — retrying', {
              attempt,
              key: input.idempotencyKey,
              code: txErr?.code || txErr?.cause?.code
            });
            await new Promise((r) => setTimeout(r, 40 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw txErr;
        }
      }

      return receipt as PostingReceipt;
    } catch (err: any) {
      logger.error('[LedgerPostingEngine] Transaction posting failed', { error: err.message });
      // Update key to failed status to allow retry
      try {
        await financeRepository.updateIdempotencyKey(externalTx || db, input.tenantId, input.idempotencyKey, {
          status: 'failed',
          responsePayload: { error: err.message }
        });
      } catch (err2: any) {
        logger.error('[LedgerPostingEngine] Failed writing failed idempotency key status', { error: err2.message });
      }
      throw err;
    } finally {
      // 9. Release Redis Distributed Lock
      await cacheService.unlock(lockKey);
    }
  },

  /**
   * Publishes a saved outbox event to QStash and tags it as published.
   */
  async publishOutboxEvent(eventId: string): Promise<void> {
    const [event] = await db
      .select()
      .from(ledgerEvents)
      .where(eq(ledgerEvents.id, eventId))
      .limit(1);

    if (!event || event.status === 'published') {
      return;
    }

    const targetUrl = `${env.EMAIL_PUBLIC_URL || 'http://localhost:3000'}/qstash/jobs`;
    
    // QStash delivery of outbox events
    try {
      await qstashService.publish(targetUrl, {
        jobType: 'ledger_transaction_event',
        data: {
          eventId: event.id,
          eventType: event.eventType,
          tenantId: event.tenantId,
          payload: event.payload
        }
      });

      await db
        .update(ledgerEvents)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(ledgerEvents.id, eventId));

      logger.info('[LedgerPostingEngine] Outbox event successfully published to QStash', { eventId });
    } catch (err: any) {
      await db
        .update(ledgerEvents)
        .set({ status: 'failed' })
        .where(eq(ledgerEvents.id, eventId));

      throw err;
    }
  }
};
