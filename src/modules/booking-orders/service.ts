import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { withTransactionRetry } from '../../lib/db-retry.js';
import { bookingOrderCounters, eventDates, ticketTypes } from '../../db/schema/index.js';
import { authAccounts } from '../../db/schema/auth-accounts.js';
import { marketingHooks } from '../marketing/hooks.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { createSlug } from '../../lib/slug.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import { canAssignBookingAttendees, canCancelBookings, canCreateBookings, canUpdateBookings, canViewBookings } from '../../policies/booking.policy.js';
import inventory from '../inventory/service.js';
import { validateTransition, isTerminalStatus, shouldReleaseInventoryOnTransition } from './lifecycle.js';
import { createAttendeeRecord, findAttendeeByTenantAndId, updateAttendeeRecord } from '../attendees/repository.js';
import { findEventByTenantAndId as findDetailedEventByTenantAndId } from '../events/repository.js';
import { findTicketTypeByTenantAndId } from '../tickets/repository.js';
import { applyIssuedTicketStatusForBookingOrder, issueIssuedTicketsForBookingOrder, reconcileIssuedTicketsAfterAssignment } from '../issued-tickets/service.js';
import {
  countActiveAssignmentsForItem,
  createBookingOrderItemAssignmentRecord,
  createBookingOrderItemRecords,
  createBookingOrderRecord,
  findActiveAssignmentForAttendee,
  findBookingOrderAttendeesForOrder,
  findBookingOrderById,
  findBookingOrderByTenantAndOrderNumber,
  findBookingOrderItemsForOrder,
  findUserById,
  listBookingOrdersForTenant,
  softDeleteBookingOrderItemAssignmentRecord,
  softDeleteBookingOrderRecord,
  updateBookingOrderRecord
} from './repository.js';
import type {
  AssignBookingOrderAttendeesDTO,
  BookingOrderAttendeesQuery,
  BookingOrderAttendeeListItem,
  BookingOrderDetailItem,
  BookingOrderItemListItem,
  BookingOrderListItem,
  BookingOrderListQuery,
  CreateBookingOrderDTO,
  UpdateBookingOrderDTO
} from './types.js';

type BookingDatabase = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
  delete: typeof db.delete;
};


function assertBookingManagementAccess(membership: TenantMembershipRecord) {
  if (!canCreateBookings(membership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
}

function assertBookingReadAccess(membership: TenantMembershipRecord) {
  if (!canViewBookings(membership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
}

function assertBookingUpdateAccess(membership: TenantMembershipRecord) {
  if (!canUpdateBookings(membership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
}

function assertBookingCancelAccess(membership: TenantMembershipRecord) {
  if (!canCancelBookings(membership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
}

function assertBookingAssignmentAccess(membership: TenantMembershipRecord) {
  if (!canAssignBookingAttendees(membership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
}

function normalizeOrderNumber(value: string) {
  return value.trim().toUpperCase();
}

function normalizeRecord(value?: Record<string, unknown> | null) {
  return value ?? {};
}

function decimalToMinorUnits(value: string | number) {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const [wholePart, fractionPart = ''] = text.split('.');
  const sign = wholePart.startsWith('-') ? -1n : 1n;
  const absWholePart = wholePart.replace('-', '');
  const whole = BigInt(absWholePart || '0');
  const fraction = BigInt((fractionPart + '00').slice(0, 2));

  return sign * (whole * 100n + fraction);
}

function minorUnitsToDecimalString(value: bigint) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');

  return `${sign}${whole.toString()}.${fraction}`;
}

function sumMinorUnits(values: Array<string | number>) {
  return values.reduce((total, current) => total + decimalToMinorUnits(current), 0n);
}

function resolveInitialOrderStatus(status: CreateBookingOrderDTO['status']) {
  if (!['draft', 'pending', 'confirmed'].includes(status)) {
    throw badRequest('Invalid initial order status');
  }

  return status;
}

function resolveOrderPrefix(source: string) {
  const slug = createSlug(source);
  const tokens = slug.split('-').filter(Boolean);

  if (tokens.length === 0) {
    return 'ORD';
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, 3).toUpperCase();
  }

  return tokens.map((token) => token[0]).join('').slice(0, 4).toUpperCase();
}

async function ensureBookingReferencesBelongToTenant(tenantId: string, input: CreateBookingOrderDTO | UpdateBookingOrderDTO) {
  if ('eventId' in input && input.eventId) {
    const event = await findDetailedEventByTenantAndId(db, tenantId, input.eventId);

    if (!event) {
      throw badRequest('Invalid eventId for tenant');
    }

    if (event.status === 'cancelled' || event.status === 'archived') {
      throw badRequest('Bookings cannot be created for cancelled or archived events');
    }
  }

  if ('purchaserUserId' in input && input.purchaserUserId) {
    const purchaser = await findUserById(db, input.purchaserUserId);

    if (!purchaser) {
      throw badRequest('Invalid purchaserUserId');
    }
  }
}

async function loadBookingOrderOrThrow(tenantId: string, orderNumber: string) {
  const order = await findBookingOrderByTenantAndOrderNumber(db, tenantId, normalizeOrderNumber(orderNumber));

  if (!order) {
    throw notFound('Booking order not found');
  }

  return order;
}

function validateStatusTransition(currentStatus: string, nextStatus: string) {
  validateTransition(currentStatus, nextStatus);
}

async function validateOrderItems(tenantId: string, eventId: string, items: CreateBookingOrderDTO['items']) {
  // delegate validation and preparation to the centralized inventory service
  const prepared = await inventory.validateAndPrepareItems(tenantId, items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity })));

  const preparedItems = prepared.map((p) => ({
    tenantId,
    bookingOrderId: '',
    ticketTypeId: p.ticketTypeId,
    quantity: p.quantity,
    unitPrice: p.unitPrice,
    subtotalAmount: minorUnitsToDecimalString(decimalToMinorUnits(p.unitPrice) * BigInt(p.quantity)),
    taxAmount: '0.00',
    totalAmount: minorUnitsToDecimalString(decimalToMinorUnits(p.unitPrice) * BigInt(p.quantity)),
    currency: p.currency,
    ticketNameSnapshot: p.ticketNameSnapshot,
    ticketSlugSnapshot: p.ticketSlugSnapshot,
    metadata: {}
  }));

  const firstCurrency = preparedItems[0]?.currency;
  if (!firstCurrency) throw badRequest('At least one booking item is required');
  for (const item of preparedItems) if (item.currency !== firstCurrency) throw badRequest('All booking items must use the same currency');

  return {
    items: preparedItems,
    currency: firstCurrency,
    subtotalAmount: minorUnitsToDecimalString(sumMinorUnits(preparedItems.map((item) => item.subtotalAmount))),
    taxAmount: '0.00',
    totalAmount: minorUnitsToDecimalString(sumMinorUnits(preparedItems.map((item) => item.totalAmount)))
  };
}

// inventory operations are delegated to `src/modules/inventory/service.ts`

function attachBookingItems<T extends BookingOrderDetailItem>(order: T, items: BookingOrderItemListItem[]) {
  return { ...order, items };
}

export async function createBookingOrder(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  input: CreateBookingOrderDTO
) {
  if (input.purchaserUserId !== actorUserId) {
    assertBookingManagementAccess(actorMembership);
  }
  await ensureBookingReferencesBelongToTenant(tenantId, input);

  const event = await findDetailedEventByTenantAndId(db, tenantId, input.eventId);

  if (!event) {
    throw badRequest('Invalid eventId for tenant');
  }

  if (event.status === 'cancelled' || event.status === 'archived') {
    throw badRequest('Bookings cannot be created for cancelled or archived events');
  }

  const purchaser = await findUserById(db, input.purchaserUserId);

  if (!purchaser) {
    throw badRequest('Invalid purchaserUserId');
  }

  // The chosen date, if any, must be one of this event's occurrences.
  if (input.eventDateId) {
    const [date] = await db
      .select({ id: eventDates.id })
      .from(eventDates)
      .where(and(eq(eventDates.id, input.eventDateId), eq(eventDates.eventId, input.eventId)))
      .limit(1);
    if (!date) {
      throw badRequest('Invalid eventDateId for event');
    }
  }

  const prepared = await validateOrderItems(tenantId, input.eventId, input.items);
  const orderStatus = resolveInitialOrderStatus(input.status);
  const now = new Date();
  const confirmedAt = orderStatus === 'confirmed' ? now : null;

  const result = await withTransactionRetry(async (tx) => {
    const year = now.getUTCFullYear();
    const prefix = resolveOrderPrefix(event.title);
    const counter = await tx
      .insert(bookingOrderCounters)
      .values({
        tenantId,
        eventId: event.id,
        year,
        prefix,
        nextSequence: 1
      })
      .onConflictDoUpdate({
        target: [bookingOrderCounters.tenantId, bookingOrderCounters.eventId, bookingOrderCounters.year],
        set: {
          nextSequence: sql`${bookingOrderCounters.nextSequence} + 1`,
          updatedAt: now
        }
      })
      .returning({ nextSequence: bookingOrderCounters.nextSequence });

    const sequence = counter[0]?.nextSequence ?? 1;
    const orderNumber = `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;

    const order = await createBookingOrderRecord(tx, {
      tenantId,
      eventId: input.eventId,
      eventDateId: input.eventDateId ?? null,
      purchaserUserId: input.purchaserUserId,
      orderNumber,
      status: orderStatus,
      currency: prepared.currency,
      subtotalAmount: prepared.subtotalAmount,
      taxAmount: prepared.taxAmount,
      totalAmount: minorUnitsToDecimalString(sumMinorUnits([prepared.subtotalAmount, prepared.taxAmount, `-${input.discountAmount.toFixed(2)}`])),
      source: input.source,
      notes: input.notes ?? null,
      expiresAt: input.expiresAt ?? null,
      confirmedAt,
      createdByUserId: actorUserId,
      discountAmount: input.discountAmount,
      metadata: normalizeRecord(input.metadata)
    });

    if (!order) {
      throw conflict('Unable to create booking order');
    }

    await inventory.reserveInventoryForBookingOrder(tx, {
      tenantId,
      eventId: order.eventId,
      bookingOrderId: order.id,
      actorUserId,
      source: input.source,
      expiresAt: input.expiresAt ?? null,
      metadata: normalizeRecord(input.metadata),
      items: input.items.map((item) => ({ ticketTypeId: item.ticketTypeId, quantity: item.quantity }))
    });

    const itemRows = await createBookingOrderItemRecords(
      tx,
      prepared.items.map((item) => ({
        ...item,
        bookingOrderId: order.id,
        metadata: item.metadata
      }))
    );

    if (orderStatus === 'confirmed') {
      await inventory.convertReservationsForBookingOrder(tx, {
        tenantId,
        bookingOrderId: order.id,
        actorUserId,
        source: 'booking-order-create',
        metadata: { bookingOrderId: order.id, trigger: 'createBookingOrder' },
        eventType: 'booking_confirmed'
      });
      await issueIssuedTicketsForBookingOrder(tx, tenantId, order.id, actorMembership);
    }

    const loadedOrder = await findBookingOrderById(tx, tenantId, order.id);

    if (!loadedOrder) {
      throw notFound('Booking order not found');
    }

    return attachBookingItems(loadedOrder, itemRows) as BookingOrderDetailItem & { items: BookingOrderItemListItem[] };
  });

  if (result && orderStatus === 'confirmed') {
    try {
      const [purchaserAccount] = await db
        .select({ email: authAccounts.email })
        .from(authAccounts)
        .where(eq(authAccounts.userId, result.purchaserUserId))
        .limit(1);

      await marketingHooks.onBookingConfirmed(
        {
          id: result.id,
          orderNumber: result.orderNumber,
          userEmail: purchaserAccount?.email || '',
          userId: result.purchaserUserId
        },
        { tenantId }
      );
    } catch (hookErr) {
      // Fail silently
    }
  }

  return result;
}

export async function listBookingOrders(tenantId: string, actorMembership: TenantMembershipRecord, input: BookingOrderListQuery) {
  assertBookingReadAccess(actorMembership);

  const pagination = parsePagination(input);
  const { rows, total } = await listBookingOrdersForTenant(db, tenantId, input, pagination);

  return {
    items: rows as BookingOrderListItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getBookingOrderByOrderNumber(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  orderNumber: string
) {
  const order = await loadBookingOrderOrThrow(tenantId, orderNumber);
  if (order.purchaserUserId !== actorUserId && !canViewBookings(actorMembership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
  return order as BookingOrderDetailItem;
}

export async function updateBookingOrderByOrderNumber(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  orderNumber: string,
  input: UpdateBookingOrderDTO
) {
  await ensureBookingReferencesBelongToTenant(tenantId, input);

  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  const current = await loadBookingOrderOrThrow(tenantId, normalizedOrderNumber);

  if (current.purchaserUserId !== actorUserId && !canUpdateBookings(actorMembership.role)) {
    throw forbidden('Insufficient booking permissions');
  }

  const nextStatus = input.status ?? current.status;
  validateTransition(current.status, nextStatus);

  const items = await findBookingOrderItemsForOrder(db, tenantId, current.id);
  const subtotalAmount = items.reduce((total, item) => total + decimalToMinorUnits(item.subtotalAmount), 0n);
  const taxAmount = items.reduce((total, item) => total + decimalToMinorUnits(item.taxAmount), 0n);
  const discountAmount = input.discountAmount === undefined ? decimalToMinorUnits(current.discountAmount) : decimalToMinorUnits(input.discountAmount);
  const totalAmount = subtotalAmount + taxAmount - discountAmount;

  if (totalAmount < 0n) {
    throw badRequest('discountAmount cannot exceed the order subtotal');
  }

  const statusChangedToTerminal = shouldReleaseInventoryOnTransition(current.status, nextStatus);
  const statusChangedAwayFromTerminal = isTerminalStatus(current.status) && !isTerminalStatus(nextStatus);

  if (statusChangedAwayFromTerminal) throw badRequest('Terminal booking orders cannot be reopened');

  // Detect no-op updates (idempotent requests that would not change any persisted fields).
  const wouldChange = (() => {
    if (nextStatus !== current.status) return true;
    if (input.source !== undefined && input.source !== current.source) return true;
    if (input.discountAmount !== undefined) {
      const incomingDiscount = minorUnitsToDecimalString(decimalToMinorUnits(input.discountAmount));
      if (incomingDiscount !== current.discountAmount) return true;
    }
    if (input.expiresAt !== undefined) {
      const incomingExpires = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
      const currentExpires = current.expiresAt ? new Date(current.expiresAt).toISOString() : null;
      if (incomingExpires !== currentExpires) return true;
    }
    if (input.notes !== undefined && input.notes !== current.notes) return true;
    if (input.metadata !== undefined && JSON.stringify(input.metadata) !== JSON.stringify(current.metadata)) return true;
    if (input.cancellationReason !== undefined && input.cancellationReason !== current.cancellationReason) return true;
    return false;
  })();

  if (!wouldChange) {
    // No database side effect required; return current record unchanged (preserve updatedAt)
    return current as BookingOrderDetailItem;
  }

  const result = await withTransactionRetry(async (tx) => {
    const updated = await updateBookingOrderRecord(tx, tenantId, normalizedOrderNumber, {
      ...input,
      status: nextStatus,
      updatedByUserId: actorUserId,
      confirmedAt: nextStatus === 'confirmed' && !current.confirmedAt ? new Date() : current.confirmedAt,
      cancelledAt: nextStatus === 'cancelled' || nextStatus === 'expired' ? current.cancelledAt ?? new Date() : current.cancelledAt,
      subtotalAmount: minorUnitsToDecimalString(subtotalAmount),
      taxAmount: minorUnitsToDecimalString(taxAmount),
      discountAmount: minorUnitsToDecimalString(discountAmount),
      totalAmount: minorUnitsToDecimalString(totalAmount)
    });

    assertOptimisticUpdate(updated);

    if (statusChangedToTerminal) {
      await inventory.releaseReservationsForBookingOrder(tx, {
        tenantId,
        bookingOrderId: updated.id,
        actorUserId,
        source: 'booking-order-status-transition',
        metadata: { previousStatus: current.status, nextStatus }
      });
    }

    if (nextStatus === 'confirmed' && current.status !== 'confirmed') {
      await inventory.convertReservationsForBookingOrder(tx, {
        tenantId,
        bookingOrderId: updated.id,
        actorUserId,
        source: 'booking-order-status-transition',
        metadata: { previousStatus: current.status, nextStatus },
        eventType: 'booking_confirmed'
      });
      await issueIssuedTicketsForBookingOrder(tx, tenantId, updated.id, actorMembership);
    }

    if (nextStatus !== 'confirmed') {
      await applyIssuedTicketStatusForBookingOrder(tx, tenantId, updated.id, nextStatus as 'draft' | 'pending' | 'confirmed' | 'paid' | 'completed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded');
    }

    const loaded = await findBookingOrderById(tx, tenantId, updated.id);

    if (!loaded) {
      throw notFound('Booking order not found');
    }

    return loaded as BookingOrderDetailItem;
  });

  const isStatusTransitionToConfirmed = nextStatus === 'confirmed' && current.status !== 'confirmed';
  if (result && isStatusTransitionToConfirmed) {
    try {
      const [purchaserAccount] = await db
        .select({ email: authAccounts.email })
        .from(authAccounts)
        .where(eq(authAccounts.userId, result.purchaserUserId))
        .limit(1);

      await marketingHooks.onBookingConfirmed(
        {
          id: result.id,
          orderNumber: result.orderNumber,
          userEmail: purchaserAccount?.email || '',
          userId: result.purchaserUserId
        },
        { tenantId }
      );
    } catch (hookErr) {
      // Fail silently
    }
  }

  return result;
}

export async function deleteBookingOrderByOrderNumber(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  orderNumber: string,
  lastKnownUpdatedAt: string
) {
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  const current = await loadBookingOrderOrThrow(tenantId, normalizedOrderNumber);

  if (current.purchaserUserId !== actorUserId && !canCancelBookings(actorMembership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
  return withTransactionRetry(async (tx) => {
    if (shouldReleaseInventoryOnTransition(current.status, 'cancelled')) {
      await inventory.releaseReservationsForBookingOrder(tx, {
        tenantId,
        bookingOrderId: current.id,
        actorUserId,
        source: 'booking-order-delete',
        metadata: { previousStatus: current.status, nextStatus: 'cancelled' }
      });
    }

    await applyIssuedTicketStatusForBookingOrder(tx, tenantId, current.id, 'cancelled');

    const deleted = await softDeleteBookingOrderRecord(tx, tenantId, normalizedOrderNumber, actorUserId, lastKnownUpdatedAt, current.cancelledAt ?? new Date());

    assertOptimisticUpdate(deleted);

    return deleted as BookingOrderDetailItem;
  });
}

export async function listBookingOrderItems(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  orderNumber: string
) {
  const order = await loadBookingOrderOrThrow(tenantId, orderNumber);
  if (order.purchaserUserId !== actorUserId && !canViewBookings(actorMembership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
  const items = await findBookingOrderItemsForOrder(db, tenantId, order.id);

  return items as BookingOrderItemListItem[];
}

export async function listBookingOrderAttendees(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  orderNumber: string,
  input: BookingOrderAttendeesQuery
) {
  const order = await loadBookingOrderOrThrow(tenantId, orderNumber);
  if (order.purchaserUserId !== actorUserId && !canViewBookings(actorMembership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
  const rows = await findBookingOrderAttendeesForOrder(db, tenantId, order.id);

  let filtered = rows as BookingOrderAttendeeListItem[];

  if (input.search) {
    const search = input.search.trim().toLowerCase();
    filtered = rows.filter((row) =>
      [row.attendeeFullName, row.attendeeEmail, row.attendeePhone].some((value) => value !== null && value.toLowerCase().includes(search))
    );
  }

  if (input.attendeeEmail) {
    filtered = filtered.filter((row) => row.attendeeEmail === input.attendeeEmail);
  }

  if (input.attendeePhone) {
    filtered = filtered.filter((row) => row.attendeePhone === input.attendeePhone!.trim());
  }

  const pagination = parsePagination(input);
  const start = (pagination.page - 1) * pagination.limit;
  const end = start + pagination.limit;

  return {
    items: filtered.slice(start, end) as BookingOrderAttendeeListItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total: filtered.length })
  };
}

export async function assignBookingOrderAttendees(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  orderNumber: string,
  input: AssignBookingOrderAttendeesDTO
) {
  const order = await loadBookingOrderOrThrow(tenantId, orderNumber);
  if (order.purchaserUserId !== actorUserId && !canAssignBookingAttendees(actorMembership.role)) {
    throw forbidden('Insufficient booking permissions');
  }
  const orderItems = await findBookingOrderItemsForOrder(db, tenantId, order.id);
  const itemsById = new Map(orderItems.map((item) => [item.id, item]));

  if (['cancelled', 'expired', 'refunded', 'partially_refunded'].includes(order.status)) {
    throw badRequest('Attendees cannot be assigned to a terminal booking order');
  }

  return db.transaction(async (tx) => {
    const assignmentIds = new Set<string>();

    for (const assignment of input.assignments) {
      const item = itemsById.get(assignment.bookingOrderItemId);

      if (!item) {
        throw badRequest('bookingOrderItemId must belong to the specified order');
      }

      let attendeeRecord;

      if (assignment.attendeeId) {
        const existingAttendee = await findAttendeeByTenantAndId(tx, tenantId, assignment.attendeeId);

        if (!existingAttendee) {
          throw badRequest('Invalid attendeeId for tenant');
        }

        if (existingAttendee.eventId !== order.eventId || existingAttendee.ticketTypeId !== item.ticketTypeId) {
          throw badRequest('attendeeId must match the booking order event and ticket type');
        }

        if (existingAttendee.status === 'cancelled') {
          throw badRequest('Cancelled attendees cannot be assigned');
        }

        attendeeRecord = existingAttendee;

        const updatedAttendee = await updateAttendeeRecord(tx, tenantId, existingAttendee.id, {
          bookingOrderId: order.id,
          updatedByUserId: actorUserId,
          lastKnownUpdatedAt: existingAttendee.updatedAt.toISOString(),
          status: existingAttendee.status === 'pending' ? 'confirmed' : undefined
        });

        assertOptimisticUpdate(updatedAttendee);
      } else if (assignment.attendee) {
        const created = await createAttendeeRecord(tx, {
          tenantId,
          eventId: order.eventId,
          ticketTypeId: item.ticketTypeId,
          bookingOrderId: order.id,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          normalizedEmail: assignment.attendee.email.trim().toLowerCase(),
          normalizedPhone: assignment.attendee.phone.trim(),
          dateOfBirthValue: assignment.attendee.dateOfBirth ? new Date(`${assignment.attendee.dateOfBirth}T00:00:00.000Z`) : null,
          checkedInAtValue: null,
          fullName: assignment.attendee.fullName,
          email: assignment.attendee.email,
          phone: assignment.attendee.phone,
          gender: assignment.attendee.gender,
          city: assignment.attendee.city,
          state: assignment.attendee.state,
          country: assignment.attendee.country,
          emergencyContactName: assignment.attendee.emergencyContactName,
          emergencyContactPhone: assignment.attendee.emergencyContactPhone,
          notes: assignment.attendee.notes,
          status: assignment.attendee.status
        });

        if (!created) {
          throw conflict('Unable to create attendee for assignment');
        }

        attendeeRecord = created;
      } else {
        throw badRequest('Either attendeeId or attendee must be provided');
      }

      const previousAssignment = await findActiveAssignmentForAttendee(tx, tenantId, attendeeRecord.id);

      if (previousAssignment) {
        await softDeleteBookingOrderItemAssignmentRecord(tx, tenantId, attendeeRecord.id);
      }

      const activeAssignments = await countActiveAssignmentsForItem(tx, tenantId, item.id);

      if (activeAssignments >= item.quantity) {
        throw conflict('No remaining capacity on this booking item');
      }

      const assignmentRecord = await createBookingOrderItemAssignmentRecord(tx, {
        tenantId,
        bookingOrderId: order.id,
        bookingOrderItemId: item.id,
        attendeeId: attendeeRecord.id,
        assignedByUserId: actorUserId
      });

      if (!assignmentRecord) {
        throw conflict('Unable to assign attendee to booking order item');
      }

      assignmentIds.add(assignmentRecord.id);
    }

    const allAssignments = await findBookingOrderAttendeesForOrder(tx, tenantId, order.id);
    await reconcileIssuedTicketsAfterAssignment(tx, tenantId, order.id);
    return allAssignments.filter((row) => assignmentIds.has(row.id)) as BookingOrderAttendeeListItem[];
  });
}