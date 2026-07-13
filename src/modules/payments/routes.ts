import { Hono } from 'hono';
import { paymentsController } from './controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import { validateBody } from '../../middlewares/validation.middleware.js';
import {
  createOrderSchema,
  refundSchema,
  verifyPaymentSchema,
  customerRefundSchema,
  requestWithdrawalSchema,
  processWithdrawalSchema
} from './schemas.js';
import { bookingRateLimit, adminRateLimit, webhookRateLimit } from '../../middlewares/rate-limit.middleware.js';
import type { AppEnv } from '../../types/context.js';

// 1. Customer Payments Router (mounted at /payments)
export const paymentsRoutes = new Hono<AppEnv>();

// Public webhooks
paymentsRoutes.post('/webhooks/razorpay', webhookRateLimit, paymentsController.handleWebhook);
paymentsRoutes.post('/withdrawals/callback', webhookRateLimit, paymentsController.handleWithdrawalCallback);

// Protected customer payment endpoints
paymentsRoutes.use('*', authMiddleware);
paymentsRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

paymentsRoutes.post('/create-order', bookingRateLimit, validateBody(createOrderSchema), paymentsController.createOrder);
paymentsRoutes.post('/orders', bookingRateLimit, validateBody(createOrderSchema), paymentsController.createOrder);
paymentsRoutes.post('/capture', bookingRateLimit, paymentsController.capturePayment);
paymentsRoutes.post('/refund', adminRateLimit, validateBody(refundSchema), paymentsController.refundPayment);
paymentsRoutes.post('/verify', bookingRateLimit, validateBody(verifyPaymentSchema), paymentsController.verifyPayment);
paymentsRoutes.get('/history', bookingRateLimit, paymentsController.getCustomerHistory);
paymentsRoutes.post('/refunds', bookingRateLimit, validateBody(customerRefundSchema), paymentsController.requestCustomerRefund);
paymentsRoutes.get('/refunds', bookingRateLimit, paymentsController.getCustomerRefunds);
paymentsRoutes.get('/refunds/:id', bookingRateLimit, paymentsController.getCustomerRefundById);
paymentsRoutes.post('/:id/sync', adminRateLimit, paymentsController.syncPaymentState);
paymentsRoutes.get('/:id/timeline', bookingRateLimit, paymentsController.getPaymentTimeline);
paymentsRoutes.get('/:id', bookingRateLimit, paymentsController.getPaymentById);


// 2. Organizer Wallet Router (mounted at /organizer)
export const organizerPaymentRoutes = new Hono<AppEnv>();

organizerPaymentRoutes.use('*', authMiddleware);
organizerPaymentRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

organizerPaymentRoutes.get('/wallet', bookingRateLimit, paymentsController.getOrganizerWallet);
organizerPaymentRoutes.get('/wallet/transactions', bookingRateLimit, paymentsController.getOrganizerWalletTransactions);
organizerPaymentRoutes.post('/withdrawals', bookingRateLimit, validateBody(requestWithdrawalSchema), paymentsController.requestWithdrawal);
organizerPaymentRoutes.get('/withdrawals', bookingRateLimit, paymentsController.getOrganizerWithdrawals);


// 3. Admin Routing (mounted at /admin)
export const paymentsAdminRoutes = new Hono<AppEnv>();

paymentsAdminRoutes.use('*', authMiddleware);
paymentsAdminRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));
paymentsAdminRoutes.use('*', requirePermission(['tenant.manage']));

paymentsAdminRoutes.post('/reconciliation/run', adminRateLimit, paymentsController.runReconciliation);
paymentsAdminRoutes.get('/reconciliation/reports', adminRateLimit, paymentsController.getReconciliationReports);

paymentsAdminRoutes.get('/ledger', adminRateLimit, paymentsController.getLedgerAccounts);
paymentsAdminRoutes.get('/ledger/transactions', adminRateLimit, paymentsController.getLedgerTransactions);
paymentsAdminRoutes.post('/settlements/run', adminRateLimit, paymentsController.runSettlements);
paymentsAdminRoutes.get('/settlements/reports', adminRateLimit, paymentsController.getSettlementReports);
paymentsAdminRoutes.post('/settlements/generate', adminRateLimit, paymentsController.generateSettlementRun);
paymentsAdminRoutes.post('/settlements/:id/approve', adminRateLimit, paymentsController.approveSettlementRun);
paymentsAdminRoutes.post('/settlements/:id/reject', adminRateLimit, paymentsController.rejectSettlementRun);
paymentsAdminRoutes.get('/withdrawals', adminRateLimit, paymentsController.getWithdrawalsAdmin);
paymentsAdminRoutes.post('/withdrawals/:id/process', adminRateLimit, validateBody(processWithdrawalSchema), paymentsController.processWithdrawalAdmin);
paymentsAdminRoutes.post('/payments/integrity-check', adminRateLimit, paymentsController.runIntegrityCheck);
paymentsAdminRoutes.get('/refunds', adminRateLimit, paymentsController.listRefundsAdmin);
paymentsAdminRoutes.post('/refunds/:id/approve', adminRateLimit, paymentsController.approveRefundAdmin);
paymentsAdminRoutes.post('/refunds/:id/reject', adminRateLimit, paymentsController.rejectRefundAdmin);

// Disputes
paymentsAdminRoutes.get('/disputes', adminRateLimit, paymentsController.listDisputesAdmin);
paymentsAdminRoutes.get('/disputes/:id', adminRateLimit, paymentsController.getDisputeByIdAdmin);
paymentsAdminRoutes.post('/disputes/:id/evidence', adminRateLimit, paymentsController.uploadEvidenceAdmin);
paymentsAdminRoutes.post('/disputes/:id/resolve', adminRateLimit, paymentsController.resolveDisputeAdmin);

// Promotions
paymentsAdminRoutes.post('/promotions', adminRateLimit, paymentsController.createPromotionAdmin);
paymentsAdminRoutes.get('/promotions', adminRateLimit, paymentsController.listPromotionsAdmin);
paymentsAdminRoutes.post('/promotions/apply', adminRateLimit, paymentsController.applyPromotionalCreditAdmin);
paymentsAdminRoutes.post('/promotions/reverse', adminRateLimit, paymentsController.reversePromotionalCreditAdmin);

// Event & Booking Adjustments
paymentsAdminRoutes.post('/events/:eventId/cancel', adminRateLimit, paymentsController.cancelEventAdmin);
paymentsAdminRoutes.post('/bookings/:bookingOrderId/upgrade', adminRateLimit, paymentsController.upgradeBookingAdmin);
paymentsAdminRoutes.post('/bookings/:bookingOrderId/downgrade', adminRateLimit, paymentsController.downgradeBookingAdmin);
paymentsAdminRoutes.post('/bookings/:bookingOrderId/reschedule', adminRateLimit, paymentsController.rescheduleBookingAdmin);
