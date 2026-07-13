import { createHash } from 'node:crypto';
import { db } from '../../../db/client.js';
import { badRequest } from '../../../lib/errors.js';
import { incrementMetric } from '../../../lib/metrics.js';
import { financeRepository } from '../repository.js';
import { LedgerTransactionBuilder } from '../posting-engine/builder.js';
import type { FinanceAccountType, PostingReceipt } from '../types.js';

type EnterpriseOperationType =
  | 'manual_credit'
  | 'manual_debit'
  | 'wallet_freeze'
  | 'wallet_unfreeze'
  | 'escrow_reserve'
  | 'escrow_freeze'
  | 'escrow_unfreeze'
  | 'escrow_adjustment'
  | 'financial_correction'
  | 'settlement_override'
  | 'refund_override'
  | 'chargeback_received'
  | 'chargeback_won'
  | 'chargeback_lost'
  | 'promotion_credit'
  | 'promotion_reversal'
  | 'fraud_hold'
  | 'fraud_release';

interface FinancialOperationInput {
  tenantId: string;
  operationType: EnterpriseOperationType;
  amount: number;
  currency?: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  actorId?: string;
  approvedBy?: string;
  organizerId?: string;
  customerId?: string;
  reason?: string;
  riskScore?: number;
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  ipAddress?: string;
  deviceInfo?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface OperationEntry {
  direction: 'debit' | 'credit';
  accountType: FinanceAccountType;
  accountName: string;
  amount: number;
  metadata?: Record<string, unknown>;
}

function decimalFromMinor(amount: number) {
  return (amount / 100).toFixed(2);
}

function buildOperationEntries(input: FinancialOperationInput): OperationEntry[] {
  const context = {
    organizerId: input.organizerId,
    customerId: input.customerId,
    reason: input.reason
  };

  switch (input.operationType) {
    case 'manual_credit':
      if (!input.organizerId) throw badRequest('organizerId is required for manual wallet credit');
      return [
        { direction: 'debit', accountType: 'SYSTEM_ADJUSTMENT', accountName: 'System Adjustment Account', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'ORGANIZER_BALANCE', accountName: `Organizer Available: ${input.organizerId}`, amount: input.amount, metadata: context }
      ];
    case 'manual_debit':
      if (!input.organizerId) throw badRequest('organizerId is required for manual wallet debit');
      return [
        { direction: 'debit', accountType: 'ORGANIZER_BALANCE', accountName: `Organizer Available: ${input.organizerId}`, amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'SYSTEM_ADJUSTMENT', accountName: 'System Adjustment Account', amount: input.amount, metadata: context }
      ];
    case 'wallet_freeze':
    case 'fraud_hold':
      if (!input.organizerId) throw badRequest('organizerId is required for wallet hold');
      return [
        { direction: 'debit', accountType: 'ORGANIZER_BALANCE', accountName: `Organizer Available: ${input.organizerId}`, amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'FRAUD_RESERVE', accountName: 'Fraud Hold Reserve', amount: input.amount, metadata: context }
      ];
    case 'wallet_unfreeze':
    case 'fraud_release':
      if (!input.organizerId) throw badRequest('organizerId is required for wallet release');
      return [
        { direction: 'debit', accountType: 'FRAUD_RESERVE', accountName: 'Fraud Hold Reserve', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'ORGANIZER_BALANCE', accountName: `Organizer Available: ${input.organizerId}`, amount: input.amount, metadata: context }
      ];
    case 'escrow_reserve':
    case 'escrow_freeze':
      return [
        { direction: 'debit', accountType: 'ESCROW', accountName: 'Platform Escrow Custody', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'RESERVE', accountName: 'Platform Cash Reserves', amount: input.amount, metadata: context }
      ];
    case 'escrow_unfreeze':
      return [
        { direction: 'debit', accountType: 'RESERVE', accountName: 'Platform Cash Reserves', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'ESCROW', accountName: 'Platform Escrow Custody', amount: input.amount, metadata: context }
      ];
    case 'chargeback_received':
      if (!input.organizerId) throw badRequest('organizerId is required for chargeback_received');
      return [
        { direction: 'debit', accountType: 'ORGANIZER_BALANCE', accountName: `Organizer Available: ${input.organizerId}`, amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'CHARGEBACK_RESERVE', accountName: 'Chargeback Reserve Fund', amount: input.amount, metadata: context }
      ];
    case 'chargeback_lost':
      return [
        { direction: 'debit', accountType: 'CHARGEBACK_RESERVE', accountName: 'Chargeback Reserve Fund', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'PAYMENT_GATEWAY_CLEARING', accountName: 'Platform Cash Clearing', amount: input.amount, metadata: context }
      ];
    case 'chargeback_won':
      if (!input.organizerId) throw badRequest('organizerId is required for chargeback_won');
      return [
        { direction: 'debit', accountType: 'CHARGEBACK_RESERVE', accountName: 'Chargeback Reserve Fund', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'ORGANIZER_BALANCE', accountName: `Organizer Available: ${input.organizerId}`, amount: input.amount, metadata: context }
      ];
    case 'promotion_credit':
      if (!input.customerId) throw badRequest('customerId is required for promotional credit');
      return [
        { direction: 'debit', accountType: 'SYSTEM_ADJUSTMENT', accountName: 'System Adjustment Account', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'CUSTOMER_LIABILITY', accountName: `Customer Liability: ${input.customerId}`, amount: input.amount, metadata: context }
      ];
    case 'promotion_reversal':
      if (!input.customerId) throw badRequest('customerId is required for promotional reversal');
      return [
        { direction: 'debit', accountType: 'CUSTOMER_LIABILITY', accountName: `Customer Liability: ${input.customerId}`, amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'SYSTEM_ADJUSTMENT', accountName: 'System Adjustment Account', amount: input.amount, metadata: context }
      ];
    case 'escrow_adjustment':
    case 'financial_correction':
    case 'settlement_override':
    case 'refund_override':
      return [
        { direction: 'debit', accountType: 'SYSTEM_ADJUSTMENT', accountName: 'System Adjustment Account', amount: input.amount, metadata: context },
        { direction: 'credit', accountType: 'SUSPENSE_ACCOUNT', accountName: 'Suspense Hold Account', amount: input.amount, metadata: context }
      ];
    default:
      throw badRequest(`Unsupported financial operation '${input.operationType}'`);
  }
}

function hashEvent(previousHash: string | null, payload: unknown) {
  return createHash('sha256')
    .update(`${previousHash ?? ''}${JSON.stringify(payload)}`)
    .digest('hex');
}

export const FinancialOperationsService = {
  async execute(input: FinancialOperationInput) {
    if (input.amount <= 0) {
      throw badRequest('Financial operation amount must be greater than zero');
    }

    const currency = input.currency ?? 'INR';
    const existing = await financeRepository.findFinancialOperationByIdempotencyKey(db, input.tenantId, input.idempotencyKey);
    if (existing && existing.status === 'completed') {
      return existing;
    }
    if (existing && existing.status === 'processing') {
      throw badRequest('Financial operation is already processing');
    }

    return db.transaction(async (tx) => {
      const operation = existing ?? await financeRepository.createFinancialOperation(tx, {
        tenantId: input.tenantId,
        operationType: input.operationType,
        status: 'processing',
        amount: decimalFromMinor(input.amount),
        currency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        approvedBy: input.approvedBy,
        riskScore: input.riskScore,
        requestId: input.requestId,
        correlationId: input.correlationId,
        traceId: input.traceId,
        ipAddress: input.ipAddress,
        deviceInfo: input.deviceInfo,
        metadata: input.metadata
      });

      const startHash = hashEvent(null, { operationId: operation.id, status: 'processing' });
      await financeRepository.createFinancialOperationEvent(tx, {
        tenantId: input.tenantId,
        operationId: operation.id,
        eventType: `${input.operationType}.processing`,
        fromStatus: existing?.status ?? 'pending',
        toStatus: 'processing',
        actorId: input.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
        traceId: input.traceId,
        currentHash: startHash,
        metadata: input.metadata
      });

      const entries = buildOperationEntries(input);
      const builder = new LedgerTransactionBuilder()
        .organization(input.tenantId)
        .type(input.operationType.toUpperCase())
        .totalAmount(input.amount)
        .currencyCode(currency)
        .reference(input.referenceType, input.referenceId)
        .idempotency(input.idempotencyKey)
        .actor(input.actorId)
        .context(input.ipAddress, input.requestId);

      for (const entry of entries) {
        if (entry.direction === 'debit') {
          builder.debit(entry.accountType, entry.amount, entry.accountName, entry.metadata);
        } else {
          builder.credit(entry.accountType, entry.amount, entry.accountName, entry.metadata);
        }
      }

      const receipt: PostingReceipt = await builder.post(tx);
      const endHash = hashEvent(startHash, receipt);
      const completed = await financeRepository.updateFinancialOperationStatus(tx, input.tenantId, operation.id, {
        status: 'completed',
        approvedBy: input.approvedBy,
        ledgerTransactionId: receipt.transactionId,
        metadata: {
          ...(operation.metadata as Record<string, unknown>),
          postingReceipt: receipt
        }
      });

      await financeRepository.createFinancialOperationEvent(tx, {
        tenantId: input.tenantId,
        operationId: operation.id,
        eventType: `${input.operationType}.completed`,
        fromStatus: 'processing',
        toStatus: 'completed',
        actorId: input.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
        traceId: input.traceId,
        previousHash: startHash,
        currentHash: endHash,
        metadata: { receipt }
      });

      incrementMetric('ledger_postings_total');
      return completed ?? operation;
    });
  },

  async list(tenantId: string, page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    return financeRepository.listFinancialOperations(db, tenantId, limit, offset);
  },

  async timeline(tenantId: string, operationId: string) {
    return financeRepository.listFinancialOperationEvents(db, tenantId, operationId);
  }
};
