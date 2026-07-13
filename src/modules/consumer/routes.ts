import { Hono } from 'hono';
import { createHmac } from 'node:crypto';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validation.middleware.js';
import { bookingRateLimit } from '../../middlewares/rate-limit.middleware.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { cacheService } from '../../lib/cache.js';
import { paymentsService } from '../payments/service.js';
import { paymentsRepository } from '../payments/repository.js';
import { createOrderSchema, verifyPaymentSchema } from '../payments/schemas.js';
import type { AppEnv } from '../../types/context.js';
import {
  createConsumerBooking,
  createConsumerCheckout,
  createConsumerPaymentOrder,
  getConsumerBooking,
  getConsumerProfile,
  getConsumerRefund,
  getConsumerTrustedContacts,
  updateConsumerTrustedContacts,
  listConsumerBookings,
  listConsumerNotifications,
  listConsumerTickets,
  markAllConsumerNotificationsRead,
  markConsumerNotificationRead,
  requestConsumerRefund,
  updateConsumerProfile,
  uploadConsumerAvatar,
  getConsumerWallet,
  createWalletRecharge,
  verifyWalletRecharge,
  checkoutWithCoins,
} from './service.js';
import { sendBookingConfirmation } from './confirmation-notify.js';
import { likeEvent, unlikeEvent, getLikedEventIds } from '../event-likes/service.js';
import { z } from 'zod';
import {
  consumerBookingParamsSchema,
  consumerCreateBookingSchema,
  consumerListQuerySchema,
  consumerNotificationIdParamsSchema,
  consumerNotificationsQuerySchema,
  consumerRefundIdParamsSchema,
  consumerRefundSchema,
  consumerTicketsQuerySchema,
  consumerTrustedContactsSchema,
  consumerUpdateProfileSchema,
  consumerAvatarUploadSchema,
  consumerWalletRechargeSchema,
  consumerWalletVerifySchema,
  type ConsumerBookingParams,
  type ConsumerCreateBookingInput,
  type ConsumerListQuery,
  type ConsumerNotificationIdParams,
  type ConsumerNotificationsQuery,
  type ConsumerRefundIdParams,
  type ConsumerRefundInput,
  type ConsumerTicketsQuery,
  type ConsumerWalletRechargeInput,
  type ConsumerWalletVerifyInput,
} from './validation.js';

// Authenticated consumer surface. Requires a logged-in user but NO tenant
// membership; the tenant is resolved from the event/booking server-side.
export const consumerRoutes = new Hono<AppEnv>();

consumerRoutes.use('*', authMiddleware);

consumerRoutes.get('/profile', async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const profile = await getConsumerProfile(user.id);
  return successResponse(c, profile, 'Profile retrieved');
});

consumerRoutes.patch('/profile', validateBody(consumerUpdateProfileSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const input = c.get('validatedBody') as Record<string, unknown>;
  const profile = await updateConsumerProfile(user.id, input);
  return successResponse(c, profile, 'Profile updated');
});

consumerRoutes.post('/avatar', validateBody(consumerAvatarUploadSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { image, mimeType } = c.get('validatedBody') as { image: string; mimeType: string };
  const result = await uploadConsumerAvatar(user.id, image, mimeType);
  return successResponse(c, result, 'Avatar updated');
});

// --- Event likes --------------------------------------------------------------
const likeEventParamsSchema = z.object({ eventId: z.string().uuid() });

// The set of events the current user has liked (drives the filled heart).
consumerRoutes.get('/likes', async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  return successResponse(c, await getLikedEventIds(user.id), 'Liked events retrieved');
});

consumerRoutes.post('/events/:eventId/like', validateParams(likeEventParamsSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { eventId } = c.get('validatedParams') as { eventId: string };
  return successResponse(c, await likeEvent(user.id, eventId), 'Event liked');
});

consumerRoutes.delete('/events/:eventId/like', validateParams(likeEventParamsSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { eventId } = c.get('validatedParams') as { eventId: string };
  return successResponse(c, await unlikeEvent(user.id, eventId), 'Event unliked');
});

consumerRoutes.get('/notifications', validateQuery(consumerNotificationsQuerySchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const input = c.get('validatedQuery') as ConsumerNotificationsQuery;
  const result = await listConsumerNotifications(user.id, input);
  return paginatedResponse(c, result.items, result.meta, 'Notifications retrieved');
});

consumerRoutes.patch('/notifications/read-all', async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const result = await markAllConsumerNotificationsRead(user.id);
  return successResponse(c, result, 'All notifications marked as read');
});

consumerRoutes.patch('/notifications/:id/read', validateParams(consumerNotificationIdParamsSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { id } = c.get('validatedParams') as ConsumerNotificationIdParams;
  const notification = await markConsumerNotificationRead(user.id, id);
  return successResponse(c, notification, 'Notification marked as read');
});

consumerRoutes.post('/bookings', bookingRateLimit, validateBody(consumerCreateBookingSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const input = c.get('validatedBody') as ConsumerCreateBookingInput;
  const booking = await createConsumerBooking(user.id, input);
  return successResponse(c, booking, 'Booking created', 201);
});

consumerRoutes.post('/checkout', bookingRateLimit, validateBody(consumerCreateBookingSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const input = c.get('validatedBody') as ConsumerCreateBookingInput;
  const result = await createConsumerCheckout(user.id, input);
  return successResponse(c, result, 'Checkout created', 201);
});

consumerRoutes.get('/bookings', validateQuery(consumerListQuerySchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const input = c.get('validatedQuery') as ConsumerListQuery;
  const result = await listConsumerBookings(user.id, input);
  return paginatedResponse(c, result.items, result.meta, 'Bookings retrieved');
});

consumerRoutes.get('/bookings/:orderNumber', validateParams(consumerBookingParamsSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { orderNumber } = c.get('validatedParams') as ConsumerBookingParams;
  const booking = await getConsumerBooking(user.id, orderNumber);
  return successResponse(c, booking, 'Booking retrieved');
});

consumerRoutes.get('/trusted-contacts', async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const contacts = await getConsumerTrustedContacts(user.id);
  return successResponse(c, contacts, 'Trusted contacts retrieved');
});

consumerRoutes.put('/trusted-contacts', validateBody(consumerTrustedContactsSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const input = c.get('validatedBody') as { contacts: Array<{ name: string; relation?: string; phone: string }> };
  const contacts = await updateConsumerTrustedContacts(user.id, input.contacts);
  return successResponse(c, contacts, 'Trusted contacts updated');
});

consumerRoutes.get('/tickets', validateQuery(consumerTicketsQuerySchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { bookingId } = c.get('validatedQuery') as ConsumerTicketsQuery;
  const tickets = await listConsumerTickets(user.id, bookingId);
  return successResponse(c, tickets, 'Tickets retrieved');
});

consumerRoutes.post('/refunds', bookingRateLimit, validateBody(consumerRefundSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const input = c.get('validatedBody') as ConsumerRefundInput;
  const refund = await requestConsumerRefund(user.id, input.bookingId, input.reason, input.refundTo);
  return successResponse(c, refund, 'Refund requested', 201);
});

consumerRoutes.get('/refunds/:id', validateParams(consumerRefundIdParamsSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { id } = c.get('validatedParams') as ConsumerRefundIdParams;
  const refund = await getConsumerRefund(user.id, id);
  return successResponse(c, refund, 'Refund retrieved');
});

consumerRoutes.post('/payments/create-order', bookingRateLimit, validateBody(createOrderSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const body = c.get('validatedBody') as { bookingOrderId?: string; bookingId?: string };
  const result = await createConsumerPaymentOrder(user.id, (body.bookingOrderId ?? body.bookingId)!);
  return successResponse(c, result, 'Razorpay order created', 201);
});

consumerRoutes.post('/payments/verify', bookingRateLimit, validateBody(verifyPaymentSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');

  const body = c.get('validatedBody') as any;
  const razorpayOrderId = body.razorpayOrderId || body.razorpay_order_id;
  const razorpayPaymentId = body.razorpayPaymentId || body.razorpay_payment_id;
  const razorpaySignature = body.razorpaySignature || body.razorpay_signature;

  const secret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
  const expectedSignature = createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    throw badRequest('Invalid payment signature');
  }

  const lockKey = `payment:confirm:${razorpayPaymentId}`;
  const lockAcquired = await cacheService.lock(lockKey, 15);
  if (!lockAcquired) {
    const existingTx = await paymentsRepository.findPaymentTransactionByRazorpayPaymentId(db, razorpayPaymentId);
    if (existingTx && existingTx.status === 'captured') {
      return successResponse(c, { verified: true }, 'Payment verified and captured (already processed)', 200);
    }
    throw badRequest('Payment verification is already in progress');
  }

  try {
    await paymentsService.confirmPaymentAndOrder(
      razorpayOrderId,
      razorpayPaymentId,
      { checkout_verified: true },
      { lockAcquired: true, reservationId: body.reservationId, reservationToken: body.reservationToken },
    );
  } finally {
    await cacheService.unlock(lockKey);
  }

  void (async () => {
    try {
      const paymentOrder = await paymentsRepository.findPaymentOrderByRazorpayOrderId(db, razorpayOrderId);
      if (paymentOrder?.bookingOrderId) {
        await sendBookingConfirmation(user.id, paymentOrder.bookingOrderId, body.email);
      }
    } catch {
    }
  })();

  return successResponse(c, { verified: true }, 'Payment verified and captured', 200);
});

// --- Customer Wallet Routes ---

consumerRoutes.get('/wallet', async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const result = await getConsumerWallet(user.id);
  return successResponse(c, result, 'Wallet retrieved');
});

consumerRoutes.post('/wallet/recharge', bookingRateLimit, validateBody(consumerWalletRechargeSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { amount } = c.get('validatedBody') as ConsumerWalletRechargeInput;
  const order = await createWalletRecharge(user.id, amount);
  return successResponse(c, order, 'Recharge order created', 201);
});

consumerRoutes.post('/wallet/recharge/verify', bookingRateLimit, validateBody(consumerWalletVerifySchema), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const body = c.get('validatedBody') as ConsumerWalletVerifyInput;
  const result = await verifyWalletRecharge(user.id, body);
  return successResponse(c, result, 'Recharge payment verified', 200);
});

consumerRoutes.post('/checkout/coins', bookingRateLimit, validateBody(z.object({ bookingOrderId: z.string().uuid() })), async (c) => {
  const user = c.get('user');
  if (!user) throw unauthorized('Authentication required');
  const { bookingOrderId } = c.get('validatedBody') as { bookingOrderId: string };
  const result = await checkoutWithCoins(user.id, bookingOrderId);
  return successResponse(c, result, 'Booking checked out successfully with coins', 200);
});

