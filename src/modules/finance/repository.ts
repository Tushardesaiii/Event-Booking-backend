import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  ledgerSnapshots,
  ledgerAccountBalances,
  ledgerLocks,
  ledgerReconciliation,
  ledgerAuditLogs,
  ledgerIdempotencyKeys,
  ledgerEvents,
  financialOperations,
  financialOperationEvents
} from '../../db/schema/ledger.js';
import type {
  LedgerAccount,
  LedgerTransaction,
  LedgerEntry,
  LedgerSnapshot,
  LedgerAccountBalance,
  LedgerAuditLog,
  LedgerIdempotencyKey,
  LedgerEvent,
  FinanceAccountType
} from './types.js';

type DBType = typeof db;
type TxOrDb = DBType | Parameters<Parameters<DBType['transaction']>[0]>[0];

export const financeRepository = {
  /**
   * Resolve or create a ledger account
   */
  async getOrCreateAccount(
    dbConn: TxOrDb,
    params: {
      tenantId: string;
      type: FinanceAccountType;
      name: string;
      currency?: string;
      precision?: number;
      minorUnit?: number;
    }
  ): Promise<LedgerAccount> {
    const [existing] = await dbConn
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.tenantId, params.tenantId),
          eq(ledgerAccounts.type, params.type),
          eq(ledgerAccounts.name, params.name)
        )
      )
      .limit(1);

    if (existing) {
      return existing;
    }

    const [record] = await dbConn
      .insert(ledgerAccounts)
      .values({
        tenantId: params.tenantId,
        type: params.type,
        name: params.name,
        currency: params.currency ?? 'INR',
        precision: params.precision ?? 2,
        minorUnit: params.minorUnit ?? 100,
        status: 'active'
      })
      .returning();

    if (!record) {
      throw new Error(`Failed to create ledger account ${params.name}`);
    }

    // Initialize running balance as 0.00
    await dbConn
      .insert(ledgerAccountBalances)
      .values({
        tenantId: params.tenantId,
        accountId: record.id,
        balance: '0.00',
        debitBalance: '0.00',
        creditBalance: '0.00'
      });

    return record;
  },

  /**
   * Find account by ID
   */
  async findAccountById(dbConn: TxOrDb, id: string): Promise<LedgerAccount | null> {
    const [record] = await dbConn
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, id))
      .limit(1);
    return record ?? null;
  },

  /**
   * Find account by Type and Name
   */
  async findAccountByType(dbConn: TxOrDb, tenantId: string, type: FinanceAccountType, name?: string): Promise<LedgerAccount | null> {
    const conds = [
      eq(ledgerAccounts.tenantId, tenantId),
      eq(ledgerAccounts.type, type)
    ];
    if (name) {
      conds.push(eq(ledgerAccounts.name, name));
    }
    const [record] = await dbConn
      .select()
      .from(ledgerAccounts)
      .where(and(...conds))
      .limit(1);
    return record ?? null;
  },

  /**
   * Get latest ledger transaction (to get current hash for chain)
   */
  async getLatestTransaction(dbConn: TxOrDb, tenantId: string): Promise<LedgerTransaction | null> {
    const [record] = await dbConn
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.tenantId, tenantId))
      .orderBy(desc(ledgerTransactions.createdAt))
      .limit(1);
    return record ?? null;
  },

  /**
   * Insert ledger transaction
   */
  async createTransaction(
    dbConn: TxOrDb,
    params: {
      tenantId: string;
      transactionType: string;
      amount: string;
      currency: string;
      referenceType: string;
      referenceId: string;
      previousHash: string | null;
      currentHash: string;
    }
  ): Promise<LedgerTransaction> {
    const [record] = await dbConn
      .insert(ledgerTransactions)
      .values({
        tenantId: params.tenantId,
        transactionType: params.transactionType,
        amount: params.amount,
        currency: params.currency,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        previousHash: params.previousHash,
        currentHash: params.currentHash
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create ledger transaction');
    }
    return record;
  },

  /**
   * Insert bulk ledger entries
   */
  async createEntries(
    dbConn: TxOrDb,
    entries: Array<{
      tenantId: string;
      accountId: string;
      ledgerTransactionId: string;
      amount: string;
      direction: 'debit' | 'credit';
      referenceType: string;
      referenceId: string;
      metadata?: any;
    }>
  ): Promise<LedgerEntry[]> {
    if (entries.length === 0) return [];
    return dbConn
      .insert(ledgerEntries)
      .values(
        entries.map((e) => ({
          tenantId: e.tenantId,
          accountId: e.accountId,
          ledgerTransactionId: e.ledgerTransactionId,
          amount: e.amount,
          direction: e.direction,
          referenceType: e.referenceType,
          referenceId: e.referenceId,
          metadata: e.metadata ?? {}
        }))
      )
      .returning();
  },

  /**
   * Idempotency check
   */
  async findIdempotencyKey(dbConn: TxOrDb, tenantId: string, key: string): Promise<LedgerIdempotencyKey | null> {
    const [record] = await dbConn
      .select()
      .from(ledgerIdempotencyKeys)
      .where(and(eq(ledgerIdempotencyKeys.tenantId, tenantId), eq(ledgerIdempotencyKeys.idempotencyKey, key)))
      .limit(1);
    return record ?? null;
  },

  /**
   * Create idempotency key
   */
  async createIdempotencyKey(
    dbConn: TxOrDb,
    params: {
      tenantId: string;
      idempotencyKey: string;
      paymentId?: string | null;
      razorpayPaymentId?: string | null;
      bookingId?: string | null;
      orderId?: string | null;
      withdrawalId?: string | null;
      refundId?: string | null;
      status: 'pending' | 'completed' | 'failed';
      responsePayload?: any;
    }
  ): Promise<LedgerIdempotencyKey> {
    const [record] = await dbConn
      .insert(ledgerIdempotencyKeys)
      .values({
        tenantId: params.tenantId,
        idempotencyKey: params.idempotencyKey,
        paymentId: params.paymentId ?? null,
        razorpayPaymentId: params.razorpayPaymentId ?? null,
        bookingId: params.bookingId ?? null,
        orderId: params.orderId ?? null,
        withdrawalId: params.withdrawalId ?? null,
        refundId: params.refundId ?? null,
        status: params.status,
        responsePayload: params.responsePayload ?? null
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create idempotency key');
    }
    return record;
  },

  /**
   * Update idempotency key status and payload
   */
  async updateIdempotencyKey(
    dbConn: TxOrDb,
    tenantId: string,
    key: string,
    params: {
      status: 'pending' | 'completed' | 'failed';
      responsePayload?: any;
    }
  ): Promise<void> {
    await dbConn
      .update(ledgerIdempotencyKeys)
      .set({
        status: params.status,
        responsePayload: params.responsePayload,
        updatedAt: new Date()
      })
      .where(and(eq(ledgerIdempotencyKeys.tenantId, tenantId), eq(ledgerIdempotencyKeys.idempotencyKey, key)));
  },

  /**
   * Write to audit log
   */
  async createAuditLog(
    dbConn: TxOrDb,
    params: {
      tenantId: string;
      userId?: string | null;
      action: string;
      entityType: string;
      entityId: string;
      ipAddress?: string | null;
      requestId?: string | null;
      source?: string | null;
      reference?: string | null;
      beforeState?: any;
      afterState?: any;
      transactionHash: string;
      metadata?: any;
    }
  ): Promise<LedgerAuditLog> {
    const [record] = await dbConn
      .insert(ledgerAuditLogs)
      .values({
        tenantId: params.tenantId,
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        ipAddress: params.ipAddress ?? null,
        requestId: params.requestId ?? null,
        source: params.source ?? null,
        reference: params.reference ?? null,
        beforeState: params.beforeState ?? null,
        afterState: params.afterState ?? null,
        transactionHash: params.transactionHash,
        metadata: params.metadata ?? {}
      })
      .returning();

    if (!record) {
      throw new Error('Failed to write audit log');
    }
    return record;
  },

  /**
   * Append transactional outbox event
   */
  async createEvent(
    dbConn: TxOrDb,
    params: {
      tenantId: string;
      eventType: string;
      payload: any;
      status?: 'pending' | 'published' | 'failed';
    }
  ): Promise<LedgerEvent> {
    const [record] = await dbConn
      .insert(ledgerEvents)
      .values({
        tenantId: params.tenantId,
        eventType: params.eventType,
        payload: params.payload,
        status: params.status ?? 'pending'
      })
      .returning();

    if (!record) {
      throw new Error('Failed to enqueue outbox event');
    }
    return record;
  },

  /**
   * Update active read models (projections)
   */
  async updateRunningBalance(
    dbConn: TxOrDb,
    accountId: string,
    tenantId: string,
    amountChange: number,
    direction: 'debit' | 'credit'
  ): Promise<void> {
    // Attempt pessimistic row locking on the balance row
    const [balanceRow] = await dbConn
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, accountId), eq(ledgerAccountBalances.tenantId, tenantId)))
      .for('update')
      .limit(1);

    const changeDecimal = amountChange / 100;
    let newDebit = parseFloat(balanceRow?.debitBalance ?? '0.00');
    let newCredit = parseFloat(balanceRow?.creditBalance ?? '0.00');

    if (direction === 'debit') {
      newDebit += changeDecimal;
    } else {
      newCredit += changeDecimal;
    }

    // Fetch the account type to enforce positive balance constraints
    const [account] = await dbConn
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId))
      .limit(1);

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Asset/Expense vs. Liability/Equity/Revenue calculations:
    // For general simplicity in ledger lookup, we compute Net balance = Credit - Debit or Debit - Credit.
    // Let's standardise balance as Credit - Debit for liabilities/revenues, and Debit - Credit for assets/clearing.
    // To keep it standard across all, we'll store Credit - Debit or just store Debit and Credit sums and compute Net.
    // Let's compute net balance as (debit_balance - credit_balance) or vice-versa.
    // Let's standardise the column `balance` as creditBalance - debitBalance.
    const newNet = newCredit - newDebit;

    // 1. Enforce No Negative Balances for ORGANIZER_BALANCE / ORGANIZER_AVAILABLE and PLATFORM_ESCROW / ESCROW (Credit normal: credit - debit >= 0)
    if (
      account.type === 'ORGANIZER_BALANCE' ||
      account.type === 'ORGANIZER_AVAILABLE' ||
      account.type === 'PLATFORM_ESCROW' ||
      account.type === 'ESCROW'
    ) {
      if (newNet < 0) {
        throw new Error(`Insufficient funds: ${account.type} balance cannot go below zero (Target: ${newNet.toFixed(2)})`);
      }
    }

    if (balanceRow) {
      await dbConn
        .update(ledgerAccountBalances)
        .set({
          debitBalance: newDebit.toFixed(2),
          creditBalance: newCredit.toFixed(2),
          balance: newNet.toFixed(2),
          updatedAt: new Date()
        })
        .where(eq(ledgerAccountBalances.id, balanceRow.id));
    } else {
      await dbConn
        .insert(ledgerAccountBalances)
        .values({
          tenantId,
          accountId,
          debitBalance: newDebit.toFixed(2),
          creditBalance: newCredit.toFixed(2),
          balance: newNet.toFixed(2)
        });
    }
  },

  /**
   * Get current running balance
   */
  async getRunningBalance(dbConn: TxOrDb, tenantId: string, accountId: string): Promise<LedgerAccountBalance | null> {
    const [record] = await dbConn
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, accountId), eq(ledgerAccountBalances.tenantId, tenantId)))
      .limit(1);
    return record ?? null;
  },

  /**
   * Acquire a lock inside the DB
   */
  /**
   * Serialize hash-chain appends for a tenant using a transaction-scoped advisory
   * lock. Two concurrent postings for the same tenant would otherwise read the
   * same chain head and fork the chain. The lock is automatically released when
   * the surrounding transaction commits or rolls back. Namespaced by a constant so
   * it never collides with other advisory-lock users.
   */
  async acquireTenantLedgerChainLock(dbConn: TxOrDb, tenantId: string): Promise<void> {
    await dbConn.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('revelis_ledger_chain'), hashtext(${tenantId}))`
    );
  },

  async acquireDbLock(dbConn: TxOrDb, tenantId: string, lockKey: string, ttlSeconds = 10): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    // Delete expired locks
    await dbConn
      .delete(ledgerLocks)
      .where(and(eq(ledgerLocks.tenantId, tenantId), eq(ledgerLocks.lockKey, lockKey), sql`expires_at < now()`));

    // Try inserting
    try {
      await dbConn
        .insert(ledgerLocks)
        .values({
          tenantId,
          lockKey,
          expiresAt
        });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Release lock in the DB
   */
  async releaseDbLock(dbConn: TxOrDb, tenantId: string, lockKey: string): Promise<void> {
    await dbConn
      .delete(ledgerLocks)
      .where(and(eq(ledgerLocks.tenantId, tenantId), eq(ledgerLocks.lockKey, lockKey)));
  },

  async findFinancialOperationByIdempotencyKey(dbConn: TxOrDb, tenantId: string, idempotencyKey: string) {
    const [record] = await dbConn
      .select()
      .from(financialOperations)
      .where(and(eq(financialOperations.tenantId, tenantId), eq(financialOperations.idempotencyKey, idempotencyKey)))
      .limit(1);
    return record ?? null;
  },

  async createFinancialOperation(
    dbConn: TxOrDb,
    params: {
      tenantId: string;
      operationType: string;
      status: string;
      amount: string;
      currency: string;
      referenceType: string;
      referenceId: string;
      idempotencyKey: string;
      actorId?: string | null;
      approvedBy?: string | null;
      ledgerTransactionId?: string | null;
      riskScore?: number | null;
      requestId?: string | null;
      correlationId?: string | null;
      traceId?: string | null;
      ipAddress?: string | null;
      deviceInfo?: any;
      metadata?: any;
    }
  ) {
    const [record] = await dbConn
      .insert(financialOperations)
      .values({
        tenantId: params.tenantId,
        operationType: params.operationType,
        status: params.status,
        amount: params.amount,
        currency: params.currency,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        idempotencyKey: params.idempotencyKey,
        actorId: params.actorId ?? null,
        approvedBy: params.approvedBy ?? null,
        ledgerTransactionId: params.ledgerTransactionId ?? null,
        riskScore: params.riskScore ?? null,
        requestId: params.requestId ?? null,
        correlationId: params.correlationId ?? null,
        traceId: params.traceId ?? null,
        ipAddress: params.ipAddress ?? null,
        deviceInfo: params.deviceInfo ?? {},
        metadata: params.metadata ?? {}
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create financial operation');
    }
    return record;
  },

  async updateFinancialOperationStatus(
    dbConn: TxOrDb,
    tenantId: string,
    operationId: string,
    params: {
      status: string;
      approvedBy?: string | null;
      ledgerTransactionId?: string | null;
      metadata?: any;
    }
  ) {
    const [record] = await dbConn
      .update(financialOperations)
      .set({
        status: params.status,
        approvedBy: params.approvedBy ?? undefined,
        ledgerTransactionId: params.ledgerTransactionId ?? undefined,
        metadata: params.metadata ?? undefined,
        updatedAt: new Date()
      })
      .where(and(eq(financialOperations.tenantId, tenantId), eq(financialOperations.id, operationId)))
      .returning();
    return record ?? null;
  },

  async createFinancialOperationEvent(
    dbConn: TxOrDb,
    params: {
      tenantId: string;
      operationId?: string | null;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actorId?: string | null;
      requestId?: string | null;
      correlationId?: string | null;
      traceId?: string | null;
      previousHash?: string | null;
      currentHash?: string | null;
      metadata?: any;
    }
  ) {
    const [record] = await dbConn
      .insert(financialOperationEvents)
      .values({
        tenantId: params.tenantId,
        operationId: params.operationId ?? null,
        eventType: params.eventType,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
        actorId: params.actorId ?? null,
        requestId: params.requestId ?? null,
        correlationId: params.correlationId ?? null,
        traceId: params.traceId ?? null,
        previousHash: params.previousHash ?? null,
        currentHash: params.currentHash ?? null,
        metadata: params.metadata ?? {}
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create financial operation event');
    }
    return record;
  },

  async listFinancialOperations(dbConn: TxOrDb, tenantId: string, limit = 50, offset = 0) {
    return dbConn
      .select()
      .from(financialOperations)
      .where(eq(financialOperations.tenantId, tenantId))
      .orderBy(desc(financialOperations.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async listFinancialOperationEvents(dbConn: TxOrDb, tenantId: string, operationId: string) {
    return dbConn
      .select()
      .from(financialOperationEvents)
      .where(and(eq(financialOperationEvents.tenantId, tenantId), eq(financialOperationEvents.operationId, operationId)))
      .orderBy(desc(financialOperationEvents.createdAt));
  }
};
