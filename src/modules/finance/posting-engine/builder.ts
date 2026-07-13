import type { FinanceAccountType, EntryInput, TransactionInput, PostingReceipt } from '../types.js';
import { LedgerPostingEngine } from './engine.js';

export class LedgerTransactionBuilder {
  private tenantId?: string;
  private transactionType?: string;
  private amount = 0;
  private currency = 'INR';
  private referenceType?: string;
  private referenceId?: string;
  private idempotencyKey?: string;
  private entries: EntryInput[] = [];
  private userId?: string;
  private ipAddress?: string;
  private requestId?: string;

  public organization(tenantId: string): this {
    this.tenantId = tenantId;
    return this;
  }

  public type(transactionType: string): this {
    this.transactionType = transactionType;
    return this;
  }

  public totalAmount(amount: number): this {
    this.amount = amount;
    return this;
  }

  public currencyCode(currency: string): this {
    this.currency = currency;
    return this;
  }

  public reference(type: string, id: string): this {
    this.referenceType = type;
    this.referenceId = id;
    return this;
  }

  public idempotency(key: string): this {
    this.idempotencyKey = key;
    return this;
  }

  public actor(userId?: string | null): this {
    if (userId) this.userId = userId;
    return this;
  }

  public context(ipAddress?: string | null, requestId?: string | null): this {
    if (ipAddress) this.ipAddress = ipAddress;
    if (requestId) this.requestId = requestId;
    return this;
  }

  public debit(accountType: FinanceAccountType, amount: number, accountName: string, metadata?: any): this {
    this.entries.push({
      accountType,
      accountName,
      amount,
      direction: 'debit',
      metadata
    });
    return this;
  }

  public credit(accountType: FinanceAccountType, amount: number, accountName: string, metadata?: any): this {
    this.entries.push({
      accountType,
      accountName,
      amount,
      direction: 'credit',
      metadata
    });
    return this;
  }

  /**
   * Execute the posting of the transaction
   */
  public async post(tx?: any): Promise<PostingReceipt> {
    // 1. Validate builder parameters
    if (!this.tenantId) throw new Error('Tenant ID is required');
    if (!this.transactionType) throw new Error('Transaction type is required');
    if (this.amount <= 0) throw new Error('Transaction amount must be positive');
    if (!this.referenceType || !this.referenceId) throw new Error('Reference type and reference ID are required');
    if (!this.idempotencyKey) throw new Error('Idempotency key is required');
    if (this.entries.length === 0) throw new Error('Transaction must contain at least one entry');

    // 2. Double-entry balancing invariant validation
    let debitSum = 0;
    let creditSum = 0;
    for (const entry of this.entries) {
      if (entry.direction === 'debit') {
        debitSum += entry.amount;
      } else {
        creditSum += entry.amount;
      }
    }

    if (debitSum !== creditSum) {
      throw new Error(`Unbalanced transaction builder. Debits (${debitSum}) must equal Credits (${creditSum})`);
    }

    if (debitSum !== this.amount) {
      throw new Error(`Transaction amount (${this.amount}) does not match entry sums (${debitSum})`);
    }

    const payload: TransactionInput = {
      tenantId: this.tenantId,
      transactionType: this.transactionType,
      amount: this.amount,
      currency: this.currency,
      referenceType: this.referenceType,
      referenceId: this.referenceId,
      idempotencyKey: this.idempotencyKey,
      entries: this.entries,
      userId: this.userId,
      ipAddress: this.ipAddress,
      requestId: this.requestId
    };

    return LedgerPostingEngine.postTransaction(tx, payload);
  }
}
