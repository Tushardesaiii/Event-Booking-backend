import type { Context } from 'hono';
import { successResponse } from '../../lib/response.js';
import { forbidden, badRequest } from '../../lib/errors.js';
import { requireParam } from '../../lib/http-context.js';
import { logger } from '../../lib/logger.js';
import { LedgerService } from './ledger/service.js';
import { LedgerAuditService } from './ledger/audit.service.js';
import { LedgerReconciliationService } from './reconciliation/service.js';
import { LedgerReportingService } from './reporting/service.js';
import { LedgerBalanceService } from './projections/service.js';
import { FinancialOperationsService } from './operations/service.js';
import { FinanceTaxService } from './tax/service.js';

function getTenantContext(c: Context) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const financeController = {
  /**
   * Trial Balance
   */
  async getTrialBalance(c: Context) {
    const { tenant } = getTenantContext(c);
    const report = await LedgerReportingService.getTrialBalance(tenant.id);
    return successResponse(c, report, 'Trial balance fetched successfully', 200);
  },

  /**
   * General Ledger
   */
  async getGeneralLedger(c: Context) {
    const { tenant } = getTenantContext(c);
    const report = await LedgerReportingService.getGeneralLedger(tenant.id);
    return successResponse(c, report, 'General ledger fetched successfully', 200);
  },

  /**
   * Account Statement
   */
  async getAccountStatement(c: Context) {
    const { tenant } = getTenantContext(c);
    const accountId = requireParam(c, 'accountId');
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

    const report = await LedgerReportingService.getAccountStatement(tenant.id, accountId, page, limit);
    return successResponse(c, report, 'Account statement fetched successfully', 200);
  },

  /**
   * Organizer Statement
   */
  async getOrganizerStatement(c: Context) {
    const { tenant } = getTenantContext(c);
    const organizerId = requireParam(c, 'organizerId');
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

    const report = await LedgerReportingService.getOrganizerStatement(tenant.id, organizerId, page, limit);
    return successResponse(c, report, 'Organizer statement fetched successfully', 200);
  },

  /**
   * Escrow Report
   */
  async getEscrowReport(c: Context) {
    const { tenant } = getTenantContext(c);
    const report = await LedgerReportingService.getEscrowReport(tenant.id);
    return successResponse(c, report, 'Escrow report fetched successfully', 200);
  },

  /**
   * Platform Revenue Report
   */
  async getPlatformRevenueReport(c: Context) {
    const { tenant } = getTenantContext(c);
    const report = await LedgerReportingService.getPlatformRevenueReport(tenant.id);
    return successResponse(c, report, 'Platform revenue report fetched successfully', 200);
  },

  /**
   * Tax Report
   */
  async getTaxReport(c: Context) {
    const { tenant } = getTenantContext(c);
    const summary = await LedgerReportingService.getTaxReport(tenant.id);
    const statutoryBreakdown = await FinanceTaxService.getTaxStatutoryReport(tenant.id);
    return successResponse(c, { ...summary, ...statutoryBreakdown }, 'Tax liabilities report fetched successfully', 200);
  },

  /**
   * List Ledger Accounts
   */
  async listAccounts(c: Context) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;

    const items = await LedgerService.listAccounts(tenant.id, page, limit);
    return successResponse(c, { items, meta: { page, limit } }, 'Ledger accounts list fetched', 200);
  },

  /**
   * List Ledger Transactions with entries
   */
  async listTransactions(c: Context) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;

    const items = await LedgerService.listTransactions(tenant.id, page, limit);
    return successResponse(c, { items, meta: { page, limit } }, 'Ledger transactions list fetched', 200);
  },

  /**
   * Trigger financial reconciliation
   */
  async runReconciliation(c: Context) {
    const { tenant } = getTenantContext(c);
    const report = await LedgerReconciliationService.runReconciliation(tenant.id);
    return successResponse(c, report, 'Financial reconciliation completed successfully', 200);
  },

  /**
   * Trigger inventory-reservations-booking-ledger reconciliation check
   */
  async reconcileInventoryAndLedger(c: Context) {
    const { tenant } = getTenantContext(c);
    const body = await c.req.json().catch(() => ({}));
    const repair = Boolean(body.repair);
    const report = await LedgerReconciliationService.reconcileInventoryAndLedger(tenant.id, repair);
    return successResponse(c, report, 'Inventory and ledger reconciliation completed successfully', 200);
  },

  /**
   * Validate Ledger cryptographic chain
   */
  async verifyChainIntegrity(c: Context) {
    const { tenant } = getTenantContext(c);
    const result = await LedgerAuditService.verifyChainIntegrity(tenant.id);
    return successResponse(c, result, 'Cryptographic chain audit check completed', 200);
  },

  /**
   * Trigger balance projections rebuild for all accounts in the tenant
   */
  async rebuildProjections(c: Context) {
    const { tenant } = getTenantContext(c);
    await LedgerBalanceService.rebuildAllTenantBalances(tenant.id);
    return successResponse(c, null, 'Ledger balance projections rebuilt successfully', 200);
  },

  async rebuildOrganizerWallet(c: Context) {
    const { tenant } = getTenantContext(c);
    const organizerId = requireParam(c, 'organizerId');
    const wallet = await LedgerBalanceService.rebuildOrganizerWallet(tenant.id, organizerId);
    return successResponse(c, wallet, 'Organizer wallet balance recalculated successfully', 200);
  },

  async verifyEscrow(c: Context) {
    const { tenant } = getTenantContext(c);
    const report = await LedgerReconciliationService.verifyEscrowBalance(tenant.id);
    return successResponse(c, report, 'Escrow balance reconciliation completed successfully', 200);
  },

  async executeOperation(c: Context) {
    const { tenant, user } = getTenantContext(c);
    const body = await c.req.json().catch(() => ({}));

    if (!body.operationType || !body.referenceType || !body.referenceId || !body.idempotencyKey) {
      throw badRequest('operationType, referenceType, referenceId, and idempotencyKey are required');
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw badRequest('amount must be a positive integer in minor currency units');
    }

    const operation = await FinancialOperationsService.execute({
      tenantId: tenant.id,
      operationType: body.operationType,
      amount,
      currency: body.currency,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      idempotencyKey: body.idempotencyKey,
      actorId: user.id,
      approvedBy: user.id,
      organizerId: body.organizerId,
      customerId: body.customerId,
      reason: body.reason,
      riskScore: body.riskScore,
      requestId: c.req.header('x-request-id') ?? body.requestId,
      correlationId: c.req.header('x-correlation-id') ?? body.correlationId,
      traceId: c.req.header('traceparent') ?? body.traceId,
      ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? undefined,
      deviceInfo: body.deviceInfo,
      metadata: body.metadata
    });

    return successResponse(c, operation, 'Financial operation completed successfully', 201);
  },

  async listOperations(c: Context) {
    const { tenant } = getTenantContext(c);
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;
    const items = await FinancialOperationsService.list(tenant.id, page, limit);
    return successResponse(c, { items, meta: { page, limit } }, 'Financial operations fetched successfully', 200);
  },

  async getOperationTimeline(c: Context) {
    const { tenant } = getTenantContext(c);
    const operationId = requireParam(c, 'operationId');
    const events = await FinancialOperationsService.timeline(tenant.id, operationId);
    return successResponse(c, events, 'Financial operation timeline fetched successfully', 200);
  }
};
