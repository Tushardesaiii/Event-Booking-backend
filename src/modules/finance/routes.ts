import { Hono } from 'hono';
import { financeController } from './controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { adminRateLimit } from '../../middlewares/rate-limit.middleware.js';
import type { AppEnv } from '../../types/context.js';

export const financeRoutes = new Hono<AppEnv>();

// Apply global middlewares: user auth, tenant verification, and admin RBAC checks
financeRoutes.use('*', authMiddleware);
financeRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));
financeRoutes.use('*', requirePermission(['tenant.manage']));

// Route definitions for the Finance Ledger Domain
financeRoutes.get('/trial-balance', adminRateLimit, financeController.getTrialBalance);
financeRoutes.get('/general-ledger', adminRateLimit, financeController.getGeneralLedger);
financeRoutes.get('/accounts', adminRateLimit, financeController.listAccounts);
financeRoutes.get('/accounts/:accountId/statement', adminRateLimit, financeController.getAccountStatement);
financeRoutes.get('/organizers/:organizerId/statement', adminRateLimit, financeController.getOrganizerStatement);
financeRoutes.get('/transactions', adminRateLimit, financeController.listTransactions);
financeRoutes.get('/operations', adminRateLimit, financeController.listOperations);
financeRoutes.get('/operations/:operationId/timeline', adminRateLimit, financeController.getOperationTimeline);
financeRoutes.post('/operations/execute', adminRateLimit, financeController.executeOperation);

financeRoutes.get('/reports/escrow', adminRateLimit, financeController.getEscrowReport);
financeRoutes.get('/reports/revenue', adminRateLimit, financeController.getPlatformRevenueReport);
financeRoutes.get('/reports/tax', adminRateLimit, financeController.getTaxReport);

financeRoutes.post('/reconciliation/run', adminRateLimit, financeController.runReconciliation);
financeRoutes.post('/reconciliation/inventory', adminRateLimit, financeController.reconcileInventoryAndLedger);
financeRoutes.get('/integrity-check', adminRateLimit, financeController.verifyChainIntegrity);
financeRoutes.post('/projections/rebuild', adminRateLimit, financeController.rebuildProjections);
financeRoutes.post('/wallets/:organizerId/recalculate', adminRateLimit, financeController.rebuildOrganizerWallet);
financeRoutes.get('/escrow/reconcile', adminRateLimit, financeController.verifyEscrow);
