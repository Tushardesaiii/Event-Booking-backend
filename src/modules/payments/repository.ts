import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { paymentOrders, paymentTransactions, paymentRefunds } from '../../db/schema/payments.js';
import {
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  organizerWallets,
  organizerWalletTransactions,
  withdrawalRequests,
  settlementRuns
} from '../../db/schema/ledger.js';
import type {
  PaymentOrderRecord,
  PaymentTransactionRecord,
  PaymentRefundRecord,
  LedgerAccountRecord,
  LedgerTransactionRecord,
  LedgerEntryRecord,
  OrganizerWalletRecord,
  OrganizerWalletTransactionRecord,
  WithdrawalRequestRecord,
  SettlementRunRecord
} from './types.js';

type DBType = typeof db;
type TxOrDb = DBType | Parameters<Parameters<DBType['transaction']>[0]>[0];

export const paymentsRepository = {
  /**
   * Create a new payment order record
   */
  async createPaymentOrder(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      bookingOrderId: string;
      razorpayOrderId: string;
      amount: string;
      currency: string;
      status: 'pending' | 'authorized' | 'captured' | 'failed' | 'cancelled' | 'refunded';
      createdBy: string;
    }
  ): Promise<PaymentOrderRecord> {
    const [record] = await dbConn
      .insert(paymentOrders)
      .values({
        tenantId: data.tenantId,
        bookingOrderId: data.bookingOrderId,
        razorpayOrderId: data.razorpayOrderId,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        createdBy: data.createdBy
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create payment order record');
    }
    return record;
  },

  /**
   * Find a payment order by ID
   */
  async findPaymentOrderById(dbConn: TxOrDb, tenantId: string, id: string): Promise<PaymentOrderRecord | null> {
    const [record] = await dbConn
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.tenantId, tenantId), eq(paymentOrders.id, id)))
      .limit(1);
    return record ?? null;
  },

  /**
   * Find a payment order by Razorpay Order ID (global lookup for webhooks)
   */
  async findPaymentOrderByRazorpayOrderId(dbConn: TxOrDb, razorpayOrderId: string): Promise<PaymentOrderRecord | null> {
    const [record] = await dbConn
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.razorpayOrderId, razorpayOrderId))
      .limit(1);
    return record ?? null;
  },

  /**
   * Update payment order status and timestamps
   */
  async updatePaymentOrderStatus(
    dbConn: TxOrDb,
    tenantId: string,
    id: string,
    status: PaymentOrderRecord['status']
  ): Promise<PaymentOrderRecord> {
    const [record] = await dbConn
      .update(paymentOrders)
      .set({
        status,
        updatedAt: new Date()
      })
      .where(and(eq(paymentOrders.tenantId, tenantId), eq(paymentOrders.id, id)))
      .returning();

    if (!record) {
      throw new Error(`Payment order not found or update failed: ${id}`);
    }
    return record;
  },

  /**
   * Create a new payment transaction record
   */
  async createPaymentTransaction(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      paymentOrderId: string;
      razorpayPaymentId: string;
      amount: string;
      currency: string;
      status: string;
      gatewayResponse: any;
    }
  ): Promise<PaymentTransactionRecord> {
    const [record] = await dbConn
      .insert(paymentTransactions)
      .values({
        tenantId: data.tenantId,
        paymentOrderId: data.paymentOrderId,
        razorpayPaymentId: data.razorpayPaymentId,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        gatewayResponse: data.gatewayResponse
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create payment transaction record');
    }
    return record;
  },

  /**
   * Find a payment transaction by Razorpay Payment ID
   */
  async findPaymentTransactionByRazorpayPaymentId(dbConn: TxOrDb, razorpayPaymentId: string): Promise<PaymentTransactionRecord | null> {
    const [record] = await dbConn
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.razorpayPaymentId, razorpayPaymentId))
      .limit(1);
    return record ?? null;
  },

  /**
   * Find a payment transaction by ID within a tenant scope
   */
  async findPaymentTransactionById(dbConn: TxOrDb, tenantId: string, id: string): Promise<PaymentTransactionRecord | null> {
    const [record] = await dbConn
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.tenantId, tenantId), eq(paymentTransactions.id, id)))
      .limit(1);
    return record ?? null;
  },

  /**
   * Create a new payment refund record
   */
  async createPaymentRefund(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      paymentTransactionId: string;
      razorpayRefundId: string;
      amount: string;
      status: string;
      reason?: string | null;
    }
  ): Promise<PaymentRefundRecord> {
    const [record] = await dbConn
      .insert(paymentRefunds)
      .values({
        tenantId: data.tenantId,
        paymentTransactionId: data.paymentTransactionId,
        razorpayRefundId: data.razorpayRefundId,
        amount: data.amount,
        status: data.status,
        reason: data.reason
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create payment refund record');
    }
    return record;
  },

  /**
   * Find a payment refund by Razorpay Refund ID
   */
  async findPaymentRefundByRazorpayRefundId(dbConn: TxOrDb, razorpayRefundId: string): Promise<PaymentRefundRecord | null> {
    const [record] = await dbConn
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.razorpayRefundId, razorpayRefundId))
      .limit(1);
    return record ?? null;
  },

  /**
   * Find all transactions for a given payment order
   */
  async findTransactionsForPaymentOrder(dbConn: TxOrDb, tenantId: string, paymentOrderId: string): Promise<PaymentTransactionRecord[]> {
    return dbConn
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.tenantId, tenantId), eq(paymentTransactions.paymentOrderId, paymentOrderId)));
  },

  /**
   * Find all refunds for a given transaction
   */
  async findRefundsForTransaction(dbConn: TxOrDb, tenantId: string, paymentTransactionId: string): Promise<PaymentRefundRecord[]> {
    return dbConn
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.tenantId, tenantId), eq(paymentRefunds.paymentTransactionId, paymentTransactionId)));
  },

  /**
   * Get or create a ledger account
   */
  async getOrCreateLedgerAccount(
    dbConn: TxOrDb,
    tenantId: string,
    type: 'PLATFORM_ESCROW' | 'PLATFORM_REVENUE' | 'ORGANIZER_BALANCE' | 'CUSTOMER_REFUNDS' | 'TAX_PAYABLE' | 'PAYMENT_GATEWAY_CLEARING',
    name: string,
    currency: string = 'INR'
  ): Promise<LedgerAccountRecord> {
    const [existing] = await dbConn
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.tenantId, tenantId), eq(ledgerAccounts.type, type), eq(ledgerAccounts.name, name)))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [record] = await dbConn
      .insert(ledgerAccounts)
      .values({
        tenantId,
        type,
        name,
        currency,
        status: 'active'
      })
      .returning();

    if (!record) {
      throw new Error(`Failed to create ledger account of type ${type}`);
    }
    return record;
  },

  /**
   * Find ledger account by type
   */
  async findLedgerAccountByType(
    dbConn: TxOrDb,
    tenantId: string,
    type: 'PLATFORM_ESCROW' | 'PLATFORM_REVENUE' | 'ORGANIZER_BALANCE' | 'CUSTOMER_REFUNDS' | 'TAX_PAYABLE' | 'PAYMENT_GATEWAY_CLEARING',
    name?: string
  ): Promise<LedgerAccountRecord | null> {
    const conditions = [
      eq(ledgerAccounts.tenantId, tenantId),
      eq(ledgerAccounts.type, type)
    ];
    if (name) {
      conditions.push(eq(ledgerAccounts.name, name));
    }
    const [record] = await dbConn
      .select()
      .from(ledgerAccounts)
      .where(and(...conditions))
      .limit(1);
    return record ?? null;
  },

  /**
   * Create ledger transaction record
   */
  async createLedgerTransaction(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      transactionType: string;
      amount: string;
      currency: string;
      referenceType: string;
      referenceId: string;
    }
  ): Promise<LedgerTransactionRecord> {
    const [record] = await dbConn
      .insert(ledgerTransactions)
      .values({
        tenantId: data.tenantId,
        transactionType: data.transactionType,
        amount: data.amount,
        currency: data.currency,
        referenceType: data.referenceType,
        referenceId: data.referenceId
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create ledger transaction');
    }
    return record;
  },

  /**
   * Create ledger entries in bulk
   */
  async createLedgerEntries(
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
  ): Promise<LedgerEntryRecord[]> {
    if (entries.length === 0) return [];
    return dbConn
      .insert(ledgerEntries)
      .values(entries.map(e => ({
        tenantId: e.tenantId,
        accountId: e.accountId,
        ledgerTransactionId: e.ledgerTransactionId,
        amount: e.amount,
        direction: e.direction,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        metadata: e.metadata ?? {}
      })))
      .returning();
  },

  /**
   * Find organizer wallet
   */
  async findOrganizerWallet(dbConn: TxOrDb, tenantId: string, organizerId: string): Promise<OrganizerWalletRecord | null> {
    const [record] = await dbConn
      .select()
      .from(organizerWallets)
      .where(and(eq(organizerWallets.tenantId, tenantId), eq(organizerWallets.organizerId, organizerId)))
      .limit(1);
    return record ?? null;
  },

  /**
   * Find organizer wallet with row locking (pessimistic lock)
   */
  async findOrganizerWalletForUpdate(dbConn: TxOrDb, tenantId: string, organizerId: string): Promise<OrganizerWalletRecord | null> {
    const [record] = await dbConn
      .select()
      .from(organizerWallets)
      .where(and(eq(organizerWallets.tenantId, tenantId), eq(organizerWallets.organizerId, organizerId)))
      .for('update')
      .limit(1);
    return record ?? null;
  },

  /**
   * Create organizer wallet
   */
  async createOrganizerWallet(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      organizerId: string;
      availableBalance?: string;
      pendingBalance?: string;
      withdrawnBalance?: string;
    }
  ): Promise<OrganizerWalletRecord> {
    const [record] = await dbConn
      .insert(organizerWallets)
      .values({
        tenantId: data.tenantId,
        organizerId: data.organizerId,
        availableBalance: data.availableBalance ?? '0.00',
        pendingBalance: data.pendingBalance ?? '0.00',
        withdrawnBalance: data.withdrawnBalance ?? '0.00'
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create organizer wallet');
    }
    return record;
  },

  /**
   * Update organizer wallet balances
   */
  async updateOrganizerWalletBalances(
    dbConn: TxOrDb,
    walletId: string,
    availableBalance: string,
    pendingBalance: string,
    withdrawnBalance: string
  ): Promise<OrganizerWalletRecord> {
    const [record] = await dbConn
      .update(organizerWallets)
      .set({
        availableBalance,
        pendingBalance,
        withdrawnBalance,
        updatedAt: new Date()
      })
      .where(eq(organizerWallets.id, walletId))
      .returning();

    if (!record) {
      throw new Error('Failed to update organizer wallet balances');
    }
    return record;
  },

  /**
   * Create organizer wallet transaction record
   */
  async createOrganizerWalletTransaction(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      organizerId: string;
      walletId: string;
      type: string;
      status: string;
      amount: string;
      currency: string;
      referenceType: string;
      referenceId: string;
      description: string;
    }
  ): Promise<OrganizerWalletTransactionRecord> {
    const [record] = await dbConn
      .insert(organizerWalletTransactions)
      .values({
        tenantId: data.tenantId,
        organizerId: data.organizerId,
        walletId: data.walletId,
        type: data.type,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        description: data.description
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create organizer wallet transaction');
    }
    return record;
  },

  /**
   * Create withdrawal request record
   */
  async createWithdrawalRequest(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      organizerId: string;
      amount: string;
      status: 'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'rejected';
    }
  ): Promise<WithdrawalRequestRecord> {
    const [record] = await dbConn
      .insert(withdrawalRequests)
      .values({
        tenantId: data.tenantId,
        organizerId: data.organizerId,
        amount: data.amount,
        status: data.status
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create withdrawal request');
    }
    return record;
  },

  /**
   * Update withdrawal request status
   */
  async updateWithdrawalRequestStatus(
    dbConn: TxOrDb,
    tenantId: string,
    id: string,
    status: 'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'rejected',
    processedBy?: string
  ): Promise<WithdrawalRequestRecord> {
    const updateData: any = {
      status,
      processedAt: new Date()
    };
    if (processedBy) {
      updateData.processedBy = processedBy;
    }

    const [record] = await dbConn
      .update(withdrawalRequests)
      .set(updateData)
      .where(and(eq(withdrawalRequests.tenantId, tenantId), eq(withdrawalRequests.id, id)))
      .returning();

    if (!record) {
      throw new Error('Failed to update withdrawal request status');
    }
    return record;
  },

  /**
   * Create settlement run record
   */
  async createSettlementRun(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      amount: string;
      status: string;
      discrepancies: any;
    }
  ): Promise<SettlementRunRecord> {
    const [record] = await dbConn
      .insert(settlementRuns)
      .values({
        tenantId: data.tenantId,
        amount: data.amount,
        status: data.status,
        discrepancies: data.discrepancies
      })
      .returning();

    if (!record) {
      throw new Error('Failed to create settlement run');
    }
    return record;
  }
};
