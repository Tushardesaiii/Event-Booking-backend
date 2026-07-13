// Consumer booking + payment orchestration. Reuses the tenant-scoped booking and
// payment services, supplying the tenant (resolved from the event/booking) and a
// synthetic "buyer" membership. This is safe because the underlying booking
// service skips all RBAC checks when the purchaser is the actor and the order is
// a self-service pending hold (no ticket issuance happens until payment).

import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { badRequest, notFound, conflict, forbidden } from '../../lib/errors.js';
import { r2Client } from '../../lib/r2.js';
import { db } from '../../db/client.js';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { randomUUID, createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { userWallets, userWalletTransactions, userWalletRecharges } from '../../db/schema/user-wallets.js';
import { paymentOrders, paymentTransactions, paymentRefunds } from '../../db/schema/payments.js';
import { inventoryReservations } from '../../db/schema/inventory-reservations.js';
import { inventoryEvents } from '../../db/schema/inventory-events.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import { events } from '../../db/schema/events.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';
import { bookingOrderItems } from '../../db/schema/booking-order-items.js';
import { organizerWallets, organizerWalletTransactions } from '../../db/schema/ledger.js';
import { issueIssuedTicketsForBookingOrder } from '../issued-tickets/service.js';
import { EscrowPostingService, RefundPostingService } from '../finance/index.js';
import { FinanceTaxService } from '../finance/tax/service.js';
import { razorpayClient, timingSafeEqualHex } from '../../lib/razorpay.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import { createBookingOrder, getBookingOrderByOrderNumber } from '../booking-orders/service.js';
import type { CreateBookingOrderDTO } from '../booking-orders/types.js';
import { paymentsService } from '../payments/service.js';
import { cloudflareCdnService } from '../media/cloudflare-cdn.service.js';
import {
  findBuyerBookingByIdOrOrderNumber,
  listBuyerBookings,
  resolvePublicEventTenantId,
  findBuyerBookingById,
  getUserById,
  updateUserProfile,
  updateUserTrustedContacts,
  type TrustedContact,
  listUserNotifications,
  markUserNotificationRead,
  markAllUserNotificationsRead,
  listUserTickets,
  findUserRefundById,
  type ConsumerProfilePatch,
} from './repository.js';

// The booking service only reads `.role` in branches that are skipped for a
// self-service pending hold, so a synthetic membership is sufficient.
function buyerMembership(tenantId: string, userId: string): TenantMembershipRecord {
  return { tenantId, userId, role: 'owner' } as unknown as TenantMembershipRecord;
}

const HOLD_MINUTES = 15;

export async function createConsumerBooking(
  userId: string,
  input: {
    eventId: string;
    eventDateId?: string | null;
    items: Array<{ ticketTypeId: string; quantity: number }>;
  },
) {
  const tenantId = await resolvePublicEventTenantId(input.eventId);

  const dto: CreateBookingOrderDTO = {
    eventId: input.eventId,
    eventDateId: input.eventDateId ?? null,
    purchaserUserId: userId,
    status: 'pending',
    source: 'mobile',
    discountAmount: 0,
    expiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString(),
    items: input.items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
  };

  return createBookingOrder(tenantId, buyerMembership(tenantId, userId), userId, dto);
}

export async function getConsumerBooking(userId: string, idOrOrderNumber: string) {
  const booking = await findBuyerBookingByIdOrOrderNumber(idOrOrderNumber, userId);
  if (!booking) {
    throw notFound('Booking not found');
  }
  return getBookingOrderByOrderNumber(
    booking.tenantId,
    buyerMembership(booking.tenantId, userId),
    userId,
    booking.orderNumber,
  );
}

export async function listConsumerBookings(
  userId: string,
  input: { page?: number; limit?: number },
) {
  const pagination = parsePagination(input);
  const rows = await listBuyerBookings(userId, pagination);
  return {
    items: rows,
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total: rows.length,
    }),
  };
}

export async function getConsumerProfile(userId: string) {
  const user = await getUserById(userId);
  if (!user) {
    throw notFound('User not found');
  }
  return user;
}

export async function updateConsumerProfile(userId: string, input: ConsumerProfilePatch) {
  const updated = await updateUserProfile(userId, input);
  if (!updated) {
    throw notFound('User not found');
  }
  return updated;
}

// Upload a profile photo. The (app-compressed) bytes always go to R2 object
// storage — the SAME pipeline the dashboard/assets module uses — and we persist
// the durable CDN URL. No bypass: a storage failure surfaces as an error
// (logged + retried by the R2 client) rather than silently falling back to an
// inline data-URI, so a saved avatar is always a real, shareable URL.
export async function uploadConsumerAvatar(userId: string, image: string, mimeType: string) {
  const base64 = image.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw badRequest('Image is empty.');
  if (buffer.length > 6 * 1024 * 1024) throw badRequest('Image is too large (max 6MB). Please pick a smaller photo.');

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const key = `avatars/${userId}/${Date.now()}.${ext}`;

  await r2Client.uploadObject(key, buffer, mimeType);
  const avatarUrl = cloudflareCdnService.buildPublicUrl(key);

  const updated = await updateUserProfile(userId, { avatarUrl });
  if (!updated) throw notFound('User not found');
  return { avatarUrl };
}

export async function listConsumerNotifications(
  userId: string,
  input: { page?: number; limit?: number; isRead?: boolean },
) {
  const pagination = parsePagination(input);
  const { rows, total } = await listUserNotifications(userId, pagination, input.isRead);
  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total }),
  };
}

export async function markConsumerNotificationRead(userId: string, id: string) {
  const notification = await markUserNotificationRead(userId, id);
  if (!notification) {
    throw notFound('Unread notification not found');
  }
  return notification;
}

export async function markAllConsumerNotificationsRead(userId: string) {
  const updatedCount = await markAllUserNotificationsRead(userId);
  return { updatedCount };
}

export async function createConsumerPaymentOrder(userId: string, bookingOrderId: string) {
  const booking = await findBuyerBookingById(bookingOrderId, userId);
  if (!booking) {
    throw notFound('Booking not found');
  }
  return paymentsService.createPaymentOrder(booking.tenantId, userId, bookingOrderId);
}

// Single-round-trip checkout: create the booking AND the Razorpay order together
// so the mobile app pays one network round trip instead of two (the two DB
// operations run back-to-back next to the database instead of across the WAN).
export async function createConsumerCheckout(
  userId: string,
  input: {
    eventId: string;
    eventDateId?: string | null;
    items: Array<{ ticketTypeId: string; quantity: number }>;
  },
) {
  const booking = await createConsumerBooking(userId, input);
  const bookingId = (booking as { id: string }).id;
  const order = await createConsumerPaymentOrder(userId, bookingId);
  return { booking, order };
}

export async function getConsumerTrustedContacts(userId: string) {
  const user = await getUserById(userId);
  if (!user) {
    throw notFound('User not found');
  }
  return user.trustedContacts ?? [];
}

export async function updateConsumerTrustedContacts(userId: string, contacts: TrustedContact[]) {
  const updated = await updateUserTrustedContacts(userId, contacts);
  if (!updated) {
    throw notFound('User not found');
  }
  return updated.trustedContacts ?? [];
}

export async function listConsumerTickets(userId: string, bookingId?: string) {
  const rows = await listUserTickets(userId, bookingId);
  return rows.map((row) => {
    const { bannerKey, thumbnailKey, ...rest } = row;
    const key = bannerKey ?? thumbnailKey ?? null;
    return {
      ...rest,
      eventImage: key ? cloudflareCdnService.buildPublicUrl(key) : null,
    };
  });
}

export async function requestConsumerRefund(userId: string, bookingId: string, reason?: string, refundTo?: 'wallet' | 'original') {
  const booking = await findBuyerBookingById(bookingId, userId);
  if (!booking) {
    throw notFound('Booking not found');
  }
  return paymentsService.requestCustomerRefund(booking.tenantId, bookingId, userId, reason, refundTo);
}

export async function getConsumerRefund(userId: string, refundId: string) {
  const refund = await findUserRefundById(userId, refundId);
  if (!refund) {
    throw notFound('Refund not found');
  }
  return refund;
}

// --- Customer Wallet integrations ---

function toMinorUnits(decimalStr: string | number): number {
  const num = typeof decimalStr === 'number' ? decimalStr : parseFloat(decimalStr);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

function toDecimalString(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

export async function getConsumerWallet(userId: string) {
  let [wallet] = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
  if (!wallet) {
    const [newWallet] = await db.insert(userWallets).values({
      userId,
      balance: '0.00',
    }).returning();
    wallet = newWallet;
  }

  const transactions = await db.select()
    .from(userWalletTransactions)
    .where(eq(userWalletTransactions.userId, userId))
    .orderBy(desc(userWalletTransactions.createdAt))
    .limit(100);

  return {
    wallet,
    transactions,
  };
}

export async function createWalletRecharge(userId: string, amount: number) {
  const minorAmount = Math.round(amount * 100);
  const receipt = `recharge_${userId.substring(0, 8)}_${Date.now()}`;

  const razorpayOrder = await razorpayClient.createOrder({
    amount: minorAmount,
    currency: 'INR',
    receipt,
  });

  await db.insert(userWalletRecharges).values({
    userId,
    razorpayOrderId: razorpayOrder.id,
    amount: amount.toFixed(2),
    status: 'pending',
  });

  return {
    razorpayOrderId: razorpayOrder.id,
    amount,
    currency: 'INR',
    keyId: razorpayClient.getKeyId(),
  };
}

export async function verifyWalletRecharge(userId: string, input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;

  const secret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
  const expectedSignature = createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (!timingSafeEqualHex(expectedSignature, razorpaySignature)) {
    throw badRequest('Invalid payment signature');
  }

  return await db.transaction(async (tx) => {
    const [recharge] = await tx.select()
      .from(userWalletRecharges)
      .where(and(
        eq(userWalletRecharges.razorpayOrderId, razorpayOrderId),
        eq(userWalletRecharges.userId, userId)
      ))
      .limit(1);

    if (!recharge) {
      throw notFound('Recharge order not found');
    }

    if (recharge.status === 'completed') {
      return { success: true, message: 'Already processed' };
    }

    await tx.update(userWalletRecharges)
      .set({
        status: 'completed',
        razorpayPaymentId,
        updatedAt: new Date()
      })
      .where(eq(userWalletRecharges.id, recharge.id));

    let [wallet] = await tx.select()
      .from(userWallets)
      .where(eq(userWallets.userId, userId))
      .limit(1);

    if (!wallet) {
      const [newWallet] = await tx.insert(userWallets).values({
        userId,
        balance: '0.00',
      }).returning();
      wallet = newWallet;
    }

    const currentBalance = parseFloat(wallet.balance);
    const rechargeAmount = parseFloat(recharge.amount);
    const newBalance = (currentBalance + rechargeAmount).toFixed(2);

    await tx.update(userWallets)
      .set({
        balance: newBalance,
        updatedAt: new Date()
      })
      .where(eq(userWallets.id, wallet.id));

    await tx.insert(userWalletTransactions).values({
      userId,
      walletId: wallet.id,
      type: 'credit',
      amount: recharge.amount,
      description: `Coins recharged via payment ID ${razorpayPaymentId}`,
      referenceType: 'recharge',
      referenceId: recharge.id,
    });

    return { success: true, balance: newBalance };
  });
}

export async function checkoutWithCoins(userId: string, bookingOrderId: string) {
  const booking = await findBuyerBookingById(bookingOrderId, userId);
  if (!booking) {
    throw notFound('Booking not found');
  }

  if (booking.status !== 'pending') {
    throw badRequest(`Booking is in invalid state: ${booking.status}`);
  }

  const tenantId = booking.tenantId;

  const walletResult = await getConsumerWallet(userId);
  const wallet = walletResult.wallet;

  const orderTotal = parseFloat(booking.totalAmount);
  const currentBalance = parseFloat(wallet.balance);

  if (currentBalance < orderTotal) {
    throw badRequest('Insufficient coin balance in your wallet. Please recharge to proceed.');
  }

  const systemMembership: TenantMembershipRecord = {
    id: '00000000-0000-0000-0000-000000000000',
    tenantId,
    userId: '00000000-0000-0000-0000-000000000000',
    role: 'owner',
    invitedByUserId: null,
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const now = new Date();

  return await db.transaction(async (tx) => {
    const reservations = await tx
      .select()
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.bookingOrderId, bookingOrderId), eq(inventoryReservations.tenantId, tenantId)))
      .orderBy(asc(inventoryReservations.id))
      .for('update');

    if (reservations.length === 0) {
      throw notFound('No inventory reservations found for this booking order');
    }

    for (const res of reservations) {
      if (res.status === 'expired' || res.expiresAt <= now) {
        throw conflict('Booking has expired. Please create a new booking.');
      } else if (['cancelled', 'released', 'failed', 'force_released', 'refund_pending', 'refunded'].includes(res.status)) {
        throw conflict(`Reservation is in terminal state: ${res.status}`);
      }
    }

    const [lockedWallet] = await tx
      .select()
      .from(userWallets)
      .where(eq(userWallets.id, wallet.id))
      .for('update');

    const walletBalance = parseFloat(lockedWallet.balance);
    if (walletBalance < orderTotal) {
      throw badRequest('Insufficient coin balance in your wallet.');
    }

    const newBalance = (walletBalance - orderTotal).toFixed(2);

    await tx.update(userWallets)
      .set({
        balance: newBalance,
        updatedAt: now
      })
      .where(eq(userWallets.id, lockedWallet.id));

    const [walletTx] = await tx.insert(userWalletTransactions).values({
      userId,
      walletId: lockedWallet.id,
      type: 'debit',
      amount: booking.totalAmount,
      description: `Purchased tickets for booking order ${booking.orderNumber}`,
      referenceType: 'ticket_purchase',
      referenceId: bookingOrderId,
    }).returning();

    for (const res of reservations) {
      await tx
        .update(inventoryReservations)
        .set({
          status: 'booked',
          convertedAt: now,
          updatedAt: now,
          version: sql`${inventoryReservations.version} + 1`
        })
        .where(eq(inventoryReservations.id, res.id));

      await tx
        .update(ticketTypes)
        .set({
          reservedQuantity: sql`GREATEST(0, ${ticketTypes.reservedQuantity} - ${res.quantity})`,
          soldQuantity: sql`${ticketTypes.soldQuantity} + ${res.quantity}`,
          updatedAt: now
        })
        .where(and(eq(ticketTypes.id, res.ticketTypeId), eq(ticketTypes.tenantId, tenantId)));

      await tx.insert(inventoryEvents).values({
        tenantId,
        eventId: res.eventId,
        ticketTypeId: res.ticketTypeId,
        reservationId: res.id,
        bookingOrderId,
        eventType: 'reservation_converted',
        actorUserId: userId,
        source: 'coins_checkout',
        previousValues: { status: res.status },
        newValues: { status: 'booked', convertedAt: now },
        metadata: {}
      });
    }

    await tx
      .update(bookingOrders)
      .set({
        status: 'paid',
        confirmedAt: now,
        updatedAt: now
      })
      .where(eq(bookingOrders.id, bookingOrderId));

    await issueIssuedTicketsForBookingOrder(tx, tenantId, bookingOrderId, systemMembership);

    const virtualOrderId = `order_wallet_${randomUUID().replace(/-/g, '')}`;
    const virtualPaymentId = `pay_wallet_${randomUUID().replace(/-/g, '')}`;

    const [paymentOrder] = await tx.insert(paymentOrders).values({
      tenantId,
      bookingOrderId,
      razorpayOrderId: virtualOrderId,
      amount: booking.totalAmount,
      currency: booking.currency,
      status: 'captured',
      createdBy: userId,
    }).returning();

    const [txRecord] = await tx.insert(paymentTransactions).values({
      tenantId,
      paymentOrderId: paymentOrder.id,
      razorpayPaymentId: virtualPaymentId,
      amount: booking.totalAmount,
      currency: booking.currency,
      status: 'captured',
      gatewayResponse: { payment_method: 'coins', walletTransactionId: walletTx.id }
    }).returning();

    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, booking.eventId))
      .limit(1);

    if (event && event.organizerId) {
      let orgWallet = await tx.select().from(organizerWallets).where(and(eq(organizerWallets.tenantId, tenantId), eq(organizerWallets.organizerId, event.organizerId))).limit(1);
      let orgWalletId = orgWallet[0]?.id;
      if (!orgWalletId) {
        const [newOrgWallet] = await tx.insert(organizerWallets).values({ tenantId, organizerId: event.organizerId }).returning();
        orgWalletId = newOrgWallet.id;
        orgWallet = [newOrgWallet];
      }

      const amountMinor = toMinorUnits(booking.totalAmount);
      const subtotalMinor = toMinorUnits(booking.subtotalAmount);
      const platformFeeMinor = FinanceTaxService.calculatePlatformFee(subtotalMinor);
      const taxMinor = FinanceTaxService.calculateGstOnAmount(platformFeeMinor, booking.currency).totalTax;
      const netOrganizerRevenueMinor = amountMinor - platformFeeMinor - taxMinor;

      const [orgWalletLocked] = await tx
        .select()
        .from(organizerWallets)
        .where(eq(organizerWallets.id, orgWalletId))
        .for('update');

      let currentPending = toMinorUnits(orgWalletLocked.pendingBalance);
      currentPending += netOrganizerRevenueMinor;

      await tx.update(organizerWallets)
        .set({
          pendingBalance: toDecimalString(currentPending),
          updatedAt: now
        })
        .where(eq(organizerWallets.id, orgWalletLocked.id));

      await tx.insert(organizerWalletTransactions).values({
        tenantId,
        organizerId: event.organizerId,
        walletId: orgWalletLocked.id,
        type: 'credit',
        status: 'pending',
        amount: toDecimalString(netOrganizerRevenueMinor),
        currency: booking.currency,
        referenceType: 'booking_order',
        referenceId: bookingOrderId,
        description: `Pending revenue for booking ${booking.orderNumber} (Paid via Coins)`
      });
    }

    const amountMinor = toMinorUnits(booking.totalAmount);
    await EscrowPostingService.postPaymentCapture({
      tenantId,
      bookingId: bookingOrderId,
      paymentId: txRecord.id,
      amount: amountMinor,
      currency: booking.currency,
      idempotencyKey: `capture:${txRecord.id}`,
      userId,
    }, tx);

    return { success: true, bookingOrderId, balance: newBalance };
  });
}

