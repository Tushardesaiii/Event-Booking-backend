import { randomBytes, createHmac } from 'node:crypto';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  bookingOrderItems,
  bookingOrders,
  inventoryEvents,
  inventoryReservations,
  ticketTypes
} from '../../db/schema/index.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { emitDomainEvent } from '../../lib/events.js';

export type InventoryItem = { ticketTypeId: string; quantity: number };

export interface InventorySummary {
  ticketTypeId: string;
  totalQuantity: number;
  soldQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

export interface ReservationItem {
  ticketTypeId: string;
  quantity: number;
  reservationToken?: string;
}

type InventoryDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

function generateReservationToken() {
  return randomBytes(24).toString('base64url');
}

function normalizeIds(ticketTypeIds: string[]) {
  return Array.from(new Set(ticketTypeIds)).sort();
}

function resolveReservationExpiresAt(value?: Date | string | null) {
  if (!value) {
    return new Date(Date.now() + 15 * 60 * 1000);
  }

  return value instanceof Date ? value : new Date(value);
}

export function validateReservationStateTransition(fromStatus: string, toStatus: string): boolean {
  if (fromStatus === toStatus) {
    return true;
  }
  const allowed: Record<string, string[]> = {
    created: ['locking_inventory', 'failed', 'active'],
    locking_inventory: ['reserved', 'failed'],
    reserved: ['payment_pending', 'expired', 'cancelled'],
    payment_pending: ['payment_started', 'expired', 'cancelled'],
    payment_started: ['payment_processing', 'expired', 'cancelled'],
    payment_processing: ['payment_verified', 'expired', 'failed'],
    payment_verified: ['converting', 'refund_pending'],
    converting: ['booked', 'failed', 'converted'],
    booked: ['released'],
    converted: ['released'],
    expired: ['refund_pending'],
    cancelled: [],
    released: [],
    force_released: [],
    refund_pending: ['refunded', 'failed'],
    refunded: [],
    active: ['locking_inventory', 'reserved', 'payment_pending', 'payment_started', 'payment_processing', 'payment_verified', 'converting', 'booked', 'converted', 'expired', 'cancelled', 'released']
  };

  const allowedTo = allowed[fromStatus] || [];
  return allowedTo.includes(toStatus);
}

function generateIdempotentToken(bookingOrderId: string, ticketTypeId: string) {
  const secret = process.env.RESERVATION_SECRET || 'revelis_inventory_secret';
  return createHmac('sha256', secret).update(`${bookingOrderId}:${ticketTypeId}`).digest('base64url');
}

async function loadTicketTypesForTenant(database: InventoryDatabase, tenantId: string, ticketTypeIds: string[]) {
  if (ticketTypeIds.length === 0) {
    return [] as Array<typeof ticketTypes.$inferSelect>;
  }

  return database
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.tenantId, tenantId), inArray(ticketTypes.id, ticketTypeIds), isNull(ticketTypes.deletedAt)))
    .orderBy(asc(ticketTypes.id));
}

async function lockTicketTypesForTenant(database: InventoryDatabase, tenantId: string, ticketTypeIds: string[]) {
  if (ticketTypeIds.length === 0) {
    return [] as Array<typeof ticketTypes.$inferSelect>;
  }

  return database
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.tenantId, tenantId), inArray(ticketTypes.id, ticketTypeIds), isNull(ticketTypes.deletedAt)))
    .orderBy(asc(ticketTypes.id))
    .for('update');
}

async function loadTicketTypesOrThrow(database: InventoryDatabase, tenantId: string, ticketTypeIds: string[]) {
  const rows = await loadTicketTypesForTenant(database, tenantId, ticketTypeIds);

  if (rows.length !== ticketTypeIds.length) {
    throw badRequest('One or more ticketTypeId values are invalid for the tenant');
  }

  return rows;
}

async function loadSoldRows(database: InventoryDatabase, tenantId: string, ticketTypeIds: string[]) {
  if (ticketTypeIds.length === 0) {
    return [] as Array<{ ticketTypeId: string; soldQuantity: number }>;
  }

  return database
    .select({
      ticketTypeId: bookingOrderItems.ticketTypeId,
      soldQuantity: sql<number>`coalesce(sum(${bookingOrderItems.quantity}), 0)`
    })
    .from(bookingOrderItems)
    .innerJoin(
      bookingOrders,
      and(
        eq(bookingOrders.id, bookingOrderItems.bookingOrderId),
        eq(bookingOrders.tenantId, tenantId),
        isNull(bookingOrders.deletedAt),
        sql`${bookingOrders.status}::text in ('confirmed', 'paid', 'completed')`
      )
    )
    .where(and(eq(bookingOrderItems.tenantId, tenantId), inArray(bookingOrderItems.ticketTypeId, ticketTypeIds)))
    .groupBy(bookingOrderItems.ticketTypeId);
}

async function loadReservedRows(database: InventoryDatabase, tenantId: string, ticketTypeIds: string[]) {
  if (ticketTypeIds.length === 0) {
    return [] as Array<{ ticketTypeId: string; reservedQuantity: number }>;
  }

  try {
    return await database
      .select({
        ticketTypeId: inventoryReservations.ticketTypeId,
        reservedQuantity: sql<number>`coalesce(sum(${inventoryReservations.quantity}), 0)`
      })
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.tenantId, tenantId),
          inArray(inventoryReservations.ticketTypeId, ticketTypeIds),
          inArray(inventoryReservations.status, [
            'active',
            'created',
            'locking_inventory',
            'reserved',
            'payment_pending',
            'payment_started',
            'payment_processing',
            'payment_verified',
            'converting'
          ]),
          isNull(inventoryReservations.deletedAt),
          isNull(inventoryReservations.convertedAt),
          isNull(inventoryReservations.releasedAt),
          sql`${inventoryReservations.expiresAt} > now()`
        )
      )
      .groupBy(inventoryReservations.ticketTypeId);
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : null;
    const message = error instanceof Error ? error.message : String(error);

    if (errorCode === '42P01' || message.includes('inventory_reservations')) {
      return [] as Array<{ ticketTypeId: string; reservedQuantity: number }>;
    }

    throw error;
  }
}

async function recordInventoryEvent(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    eventId: string;
    ticketTypeId: string;
    reservationId?: string | null;
    bookingOrderId?: string | null;
    eventType:
      | 'reservation_created'
      | 'reservation_expired'
      | 'reservation_released'
      | 'reservation_converted'
      | 'booking_confirmed'
      | 'inventory_adjusted'
      | 'refund_restored'
      | 'admin_override'
      | 'reservation_locked'
      | 'reservation_extended'
      | 'reservation_cancelled'
      | 'reservation_recovered'
      | 'payment_linked'
      | 'inventory_released'
      | 'refund_triggered'
      | 'inventory_reconciled';
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
    previousValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
) {
  await database.insert(inventoryEvents).values({
    tenantId: input.tenantId,
    eventId: input.eventId,
    ticketTypeId: input.ticketTypeId,
    reservationId: input.reservationId ?? null,
    bookingOrderId: input.bookingOrderId ?? null,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? null,
    correlationId: input.correlationId ?? null,
    previousValues: input.previousValues ?? {},
    newValues: input.newValues ?? {},
    metadata: input.metadata ?? {}
  });
}

export async function getInventorySummaries(database: InventoryDatabase, tenantId: string, ticketTypeIds: string[]) {
  const ids = normalizeIds(ticketTypeIds);

  if (ids.length === 0) {
    return new Map<string, InventorySummary>();
  }

  const tickets = await loadTicketTypesOrThrow(database, tenantId, ids);
  const soldRows = await loadSoldRows(database, tenantId, ids);
  const reservedRows = await loadReservedRows(database, tenantId, ids);

  const soldById = new Map(soldRows.map((row) => [row.ticketTypeId, row.soldQuantity]));
  const reservedById = new Map(reservedRows.map((row) => [row.ticketTypeId, row.reservedQuantity]));

  return new Map(
    tickets.map((ticket) => {
      const soldQuantity = soldById.get(ticket.id) ?? 0;
      const reservedQuantity = reservedById.get(ticket.id) ?? 0;

      return [ticket.id, {
        ticketTypeId: ticket.id,
        totalQuantity: ticket.totalQuantity,
        soldQuantity,
        reservedQuantity,
        availableQuantity: Math.max(0, ticket.totalQuantity - soldQuantity - reservedQuantity)
      }] as const;
    })
  );
}

export async function withDerivedInventory<T extends { id: string; totalQuantity: number; soldQuantity: number; reservedQuantity: number }>(
  database: InventoryDatabase,
  tenantId: string,
  rows: T[]
) {
  if (rows.length === 0) {
    return [] as Array<T & { availableQuantity: number }>;
  }

  const inventory = await getInventorySummaries(database, tenantId, rows.map((row) => row.id));

  return rows.map((row) => {
    const summary = inventory.get(row.id);

    if (!summary) {
      return {
        ...row,
        availableQuantity: Math.max(0, row.totalQuantity - row.soldQuantity - row.reservedQuantity)
      };
    }

    return {
      ...row,
      soldQuantity: summary.soldQuantity,
      reservedQuantity: summary.reservedQuantity,
      availableQuantity: summary.availableQuantity
    };
  });
}

// Validate ticket sale constraints and prepare snapshot-friendly pricing data.
export async function validateAndPrepareItems(tenantId: string, items: Array<{ ticketTypeId: string; quantity: number }>) {
  if (items.length === 0) throw badRequest('At least one booking item is required');

  const ticketRows = await Promise.all(
    items.map((it) =>
      db
        .select()
        .from(ticketTypes)
        .where(and(eq(ticketTypes.id, it.ticketTypeId), eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)))
        .limit(1)
        .then((r) => r[0] ?? null)
    )
  );

  const ticketsById = new Map(ticketRows.filter(Boolean).map((ticket) => [ticket!.id, ticket!]));

  const prepared = items.map((it) => {
    const ticket = ticketsById.get(it.ticketTypeId);
    if (!ticket) throw badRequest('One or more ticketTypeId values are invalid for the tenant');

    const now = Date.now();
    if (ticket.status !== 'active') throw badRequest(`Ticket type ${ticket.name} is not active`);
    if (ticket.saleStartDate && new Date(ticket.saleStartDate).getTime() > now) throw badRequest(`Ticket type ${ticket.name} is not on sale yet`);
    if (ticket.saleEndDate && new Date(ticket.saleEndDate).getTime() < now) throw badRequest(`Ticket type ${ticket.name} sale has ended`);

    if (it.quantity < ticket.minPerOrder || it.quantity > ticket.maxPerOrder) throw badRequest(`Quantity for ${ticket.name} must be between ${ticket.minPerOrder} and ${ticket.maxPerOrder}`);

    return {
      ticket,
      ticketTypeId: it.ticketTypeId,
      quantity: it.quantity,
      unitPrice: String(ticket.price),
      currency: ticket.currency,
      ticketNameSnapshot: ticket.name,
      ticketSlugSnapshot: ticket.slug
    };
  });

  return prepared;
}

async function createReservationsForItems(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    eventId: string;
    bookingOrderId?: string | null;
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
    expiresAt?: Date | string | null;
    metadata?: Record<string, unknown>;
    items: ReservationItem[];
  }
) {
  if (input.items.length === 0) {
    throw badRequest('At least one reservation item is required');
  }

  const ids = normalizeIds(input.items.map((item) => item.ticketTypeId));
  await lockTicketTypesForTenant(database, input.tenantId, ids);
  await loadTicketTypesOrThrow(database, input.tenantId, ids);
  const inventory = await getInventorySummaries(database, input.tenantId, ids);
  const expiresAt = resolveReservationExpiresAt(input.expiresAt);

  for (const item of input.items) {
    if (item.quantity <= 0) {
      throw badRequest('Reservation quantity must be positive');
    }

    const summary = inventory.get(item.ticketTypeId);

    if (!summary) {
      throw badRequest('One or more ticketTypeId values are invalid for the tenant');
    }

    if (item.quantity > summary.availableQuantity) {
      throw conflict(`Insufficient inventory for ticket ${item.ticketTypeId}`);
    }
  }

  const created = [] as Array<typeof inventoryReservations.$inferSelect>;

  for (const item of input.items) {
    const reservationToken = item.reservationToken ?? `${input.bookingOrderId ?? input.correlationId ?? generateReservationToken()}:${item.ticketTypeId}`;
    const [reservation] = await database
      .insert(inventoryReservations)
      .values({
        tenantId: input.tenantId,
        eventId: input.eventId,
        ticketTypeId: item.ticketTypeId,
        bookingOrderId: input.bookingOrderId ?? null,
        reservationToken,
        quantity: item.quantity,
        status: 'active',
        expiresAt,
        convertedAt: null,
        releasedAt: null,
        metadata: input.metadata ?? {},
        createdByUserId: input.actorUserId ?? null,
        updatedByUserId: input.actorUserId ?? null
      })
      .onConflictDoNothing({ target: [inventoryReservations.tenantId, inventoryReservations.reservationToken] })
      .returning();

    if (reservation) {
      created.push(reservation);

      await database
        .update(ticketTypes)
        .set({
          reservedQuantity: sql`${ticketTypes.reservedQuantity} + ${item.quantity}`,
          updatedAt: new Date()
        })
        .where(and(eq(ticketTypes.id, item.ticketTypeId), eq(ticketTypes.tenantId, input.tenantId)));

      await recordInventoryEvent(database, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        ticketTypeId: item.ticketTypeId,
        reservationId: reservation.id,
        bookingOrderId: input.bookingOrderId ?? null,
        eventType: 'reservation_created',
        actorUserId: input.actorUserId ?? null,
        source: input.source ?? 'inventory',
        correlationId: input.correlationId ?? reservation.reservationToken,
        previousValues: {},
        newValues: {
          quantity: reservation.quantity,
          expiresAt: reservation.expiresAt,
          status: reservation.status,
          reservationToken: reservation.reservationToken
        },
        metadata: input.metadata ?? {}
      });
      continue;
    }

    const [existing] = await database
      .select()
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.tenantId, input.tenantId), eq(inventoryReservations.reservationToken, reservationToken), isNull(inventoryReservations.deletedAt)))
      .limit(1);

    if (existing) {
      created.push(existing);
      continue;
    }

    throw conflict(`Unable to create reservation for ticket ${item.ticketTypeId}`);
  }

  return created;
}

async function loadReservationsForOrder(database: InventoryDatabase, tenantId: string, bookingOrderId: string) {
  return database
    .select()
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.bookingOrderId, bookingOrderId), isNull(inventoryReservations.deletedAt)))
    .orderBy(asc(inventoryReservations.id))
    .for('update');
}

async function transitionReservation(
  database: InventoryDatabase,
  reservation: Awaited<ReturnType<typeof loadReservationsForOrder>>[number],
  nextStatus: string,
  actorUserId?: string | null,
  source?: string | null,
  correlationId?: string | null,
  metadata?: Record<string, unknown>,
  eventType:
    | 'reservation_created'
    | 'reservation_expired'
    | 'reservation_released'
    | 'reservation_converted'
    | 'booking_confirmed'
    | 'inventory_adjusted'
    | 'refund_restored'
    | 'admin_override'
    | 'reservation_locked'
    | 'reservation_extended'
    | 'reservation_cancelled'
    | 'reservation_recovered'
    | 'payment_linked'
    | 'inventory_released'
    | 'refund_triggered'
    | 'inventory_reconciled' = 'admin_override'
) {
  if (reservation.status === nextStatus) {
    return reservation;
  }

  if (!validateReservationStateTransition(reservation.status, nextStatus)) {
    throw conflict(`Invalid reservation state transition from ${reservation.status} to ${nextStatus}`);
  }

  const now = new Date();
  const [updated] = await database
    .update(inventoryReservations)
    .set({
      status: nextStatus as any,
      convertedAt: nextStatus === 'booked' || nextStatus === 'converted' ? now : reservation.convertedAt,
      releasedAt: ['released', 'expired', 'cancelled', 'failed', 'force_released'].includes(nextStatus) ? now : reservation.releasedAt,
      updatedByUserId: actorUserId ?? reservation.updatedByUserId,
      updatedAt: now
    })
    .where(and(eq(inventoryReservations.id, reservation.id), eq(inventoryReservations.status, reservation.status), isNull(inventoryReservations.deletedAt)))
    .returning();

  if (!updated) {
    return null;
  }

  const activeStatuses = [
    'active',
    'created',
    'locking_inventory',
    'reserved',
    'payment_pending',
    'payment_started',
    'payment_processing',
    'payment_verified',
    'converting'
  ];

  const wasActive = activeStatuses.includes(reservation.status);
  const isNowActive = activeStatuses.includes(nextStatus);

  if (wasActive && !isNowActive) {
    if (['booked', 'converted'].includes(nextStatus)) {
      await database
        .update(ticketTypes)
        .set({
          reservedQuantity: sql`GREATEST(0, ${ticketTypes.reservedQuantity} - ${updated.quantity})`,
          soldQuantity: sql`${ticketTypes.soldQuantity} + ${updated.quantity}`,
          updatedAt: new Date()
        })
        .where(eq(ticketTypes.id, updated.ticketTypeId));
    } else {
      await database
        .update(ticketTypes)
        .set({
          reservedQuantity: sql`GREATEST(0, ${ticketTypes.reservedQuantity} - ${updated.quantity})`,
          updatedAt: new Date()
        })
        .where(eq(ticketTypes.id, updated.ticketTypeId));
    }
  } else if (!wasActive && isNowActive) {
    await database
      .update(ticketTypes)
      .set({
        reservedQuantity: sql`${ticketTypes.reservedQuantity} + ${updated.quantity}`,
        updatedAt: new Date()
      })
      .where(eq(ticketTypes.id, updated.ticketTypeId));
  }

  await recordInventoryEvent(database, {
    tenantId: updated.tenantId,
    eventId: updated.eventId,
    ticketTypeId: updated.ticketTypeId,
    reservationId: updated.id,
    bookingOrderId: updated.bookingOrderId,
    eventType,
    actorUserId: actorUserId ?? null,
    source: source ?? 'inventory',
    correlationId: correlationId ?? updated.reservationToken,
    previousValues: {
      status: reservation.status,
      convertedAt: reservation.convertedAt,
      releasedAt: reservation.releasedAt
    },
    newValues: {
      status: updated.status,
      convertedAt: updated.convertedAt,
      releasedAt: updated.releasedAt
    },
    metadata: metadata ?? {}
  });

  if (nextStatus === 'expired') {
    emitDomainEvent('ReservationExpired', {
      tenantId: updated.tenantId,
      eventId: updated.eventId,
      ticketTypeId: updated.ticketTypeId,
      reservationId: updated.id,
      quantity: updated.quantity
    });
    emitDomainEvent('InventoryReleased', {
      tenantId: updated.tenantId,
      eventId: updated.eventId,
      ticketTypeId: updated.ticketTypeId,
      quantity: updated.quantity,
      reason: 'expiry'
    });
  } else if (['released', 'cancelled', 'failed', 'force_released'].includes(nextStatus)) {
    emitDomainEvent('InventoryReleased', {
      tenantId: updated.tenantId,
      eventId: updated.eventId,
      ticketTypeId: updated.ticketTypeId,
      quantity: updated.quantity,
      reason: nextStatus
    });
  }

  return updated;
}

export async function reserveInventoryForBookingOrder(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    eventId: string;
    bookingOrderId: string;
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
    expiresAt?: Date | string | null;
    metadata?: Record<string, unknown>;
    items: InventoryItem[];
  }
) {
  return createReservationsForItems(database, {
    ...input,
    items: input.items.map((item) => ({
      ticketTypeId: item.ticketTypeId,
      quantity: item.quantity,
      reservationToken: generateIdempotentToken(input.bookingOrderId, item.ticketTypeId)
    }))
  });
}

export async function reserveInventoryWithoutOrder(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    eventId: string;
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
    expiresAt?: Date | string | null;
    metadata?: Record<string, unknown>;
    items: ReservationItem[];
  }
) {
  return createReservationsForItems(database, input);
}

export async function convertReservationsForBookingOrder(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    bookingOrderId: string;
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
    metadata?: Record<string, unknown>;
    eventType?: 'reservation_converted' | 'booking_confirmed';
  }
) {
  const reservations = await loadReservationsForOrder(database, input.tenantId, input.bookingOrderId);
  const converted = [] as Array<typeof inventoryReservations.$inferSelect>;

  for (const reservation of reservations) {
    if (reservation.status === 'converted' || reservation.status === 'booked') {
      continue;
    }

    const updated = await transitionReservation(
      database,
      reservation,
      'converted',
      input.actorUserId ?? null,
      input.source ?? 'inventory',
      input.correlationId ?? reservation.reservationToken,
      input.metadata,
      input.eventType ?? 'reservation_converted'
    );

    if (updated) {
      converted.push(updated);
    }
  }

  return converted;
}

export async function releaseReservationsForBookingOrder(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    bookingOrderId: string;
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const reservations = await loadReservationsForOrder(database, input.tenantId, input.bookingOrderId);
  const released = [] as Array<typeof inventoryReservations.$inferSelect>;

  for (const reservation of reservations) {
    if (['released', 'expired', 'cancelled', 'failed', 'force_released'].includes(reservation.status)) {
      continue;
    }

    const updated = await transitionReservation(
      database,
      reservation,
      'released',
      input.actorUserId ?? null,
      input.source ?? 'inventory',
      input.correlationId ?? reservation.reservationToken,
      input.metadata,
      'reservation_released'
    );

    if (updated) {
      released.push(updated);
    }
  }

  return released;
}

export async function expireDueReservations(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    batchSize?: number;
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
  }
) {
  const dueReservations = await database
    .select({ id: inventoryReservations.id })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.tenantId, input.tenantId),
        inArray(inventoryReservations.status, [
          'active',
          'created',
          'locking_inventory',
          'reserved',
          'payment_pending',
          'payment_started',
          'payment_processing'
        ]),
        isNull(inventoryReservations.deletedAt),
        isNull(inventoryReservations.convertedAt),
        isNull(inventoryReservations.releasedAt),
        sql`${inventoryReservations.expiresAt} <= now()`
      )
    )
    .orderBy(asc(inventoryReservations.expiresAt), asc(inventoryReservations.id))
    .limit(input.batchSize ?? 100);

  if (dueReservations.length === 0) {
    return [];
  }

  const dueIds = dueReservations.map(r => r.id).sort();

  const reservations = await database
    .select()
    .from(inventoryReservations)
    .where(inArray(inventoryReservations.id, dueIds))
    .orderBy(asc(inventoryReservations.id))
    .for('update');

  const expired = [] as Array<typeof inventoryReservations.$inferSelect>;

  for (const reservation of reservations) {
    const updated = await transitionReservation(
      database,
      reservation,
      'expired',
      input.actorUserId ?? null,
      input.source ?? 'inventory-expiry-worker',
      input.correlationId ?? reservation.reservationToken,
      { reason: 'reservation_expired_worker' },
      'reservation_expired'
    );

    if (updated) {
      expired.push(updated);
    }
  }

  return expired;
}

export async function reconcileCachedInventory(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    ticketTypeIds?: string[];
    repair?: boolean;
    actorUserId?: string | null;
    source?: string | null;
    correlationId?: string | null;
  }
) {
  const rows = input.ticketTypeIds && input.ticketTypeIds.length > 0
    ? await loadTicketTypesOrThrow(database, input.tenantId, normalizeIds(input.ticketTypeIds))
    : await database
      .select()
      .from(ticketTypes)
      .where(and(eq(ticketTypes.tenantId, input.tenantId), isNull(ticketTypes.deletedAt)))
      .orderBy(asc(ticketTypes.id));

  const summaries = await getInventorySummaries(database, input.tenantId, rows.map((row) => row.id));
  const drifts = [] as Array<{
    ticketTypeId: string;
    cacheSoldQuantity: number;
    cacheReservedQuantity: number;
    derivedSoldQuantity: number;
    derivedReservedQuantity: number;
    derivedAvailableQuantity: number;
  }>;

  for (const row of rows) {
    const summary = summaries.get(row.id);

    if (!summary) {
      continue;
    }

    if (row.soldQuantity !== summary.soldQuantity || row.reservedQuantity !== summary.reservedQuantity) {
      drifts.push({
        ticketTypeId: row.id,
        cacheSoldQuantity: row.soldQuantity,
        cacheReservedQuantity: row.reservedQuantity,
        derivedSoldQuantity: summary.soldQuantity,
        derivedReservedQuantity: summary.reservedQuantity,
        derivedAvailableQuantity: summary.availableQuantity
      });

      await recordInventoryEvent(database, {
        tenantId: input.tenantId,
        eventId: row.eventId,
        ticketTypeId: row.id,
        eventType: 'inventory_adjusted',
        actorUserId: input.actorUserId ?? null,
        source: input.source ?? 'inventory-reconciliation',
        correlationId: input.correlationId ?? row.id,
        previousValues: {
          soldQuantity: row.soldQuantity,
          reservedQuantity: row.reservedQuantity
        },
        newValues: {
          soldQuantity: summary.soldQuantity,
          reservedQuantity: summary.reservedQuantity,
          availableQuantity: summary.availableQuantity
        },
        metadata: {
          repaired: Boolean(input.repair)
        }
      });

      if (input.repair) {
        await database
          .update(ticketTypes)
          .set({
            soldQuantity: summary.soldQuantity,
            reservedQuantity: summary.reservedQuantity,
            updatedAt: new Date()
          })
          .where(and(eq(ticketTypes.id, row.id), eq(ticketTypes.tenantId, input.tenantId), isNull(ticketTypes.deletedAt)));
      }
    }
  }

  return drifts;
}

export async function extendReservationTTL(
  database: InventoryDatabase,
  input: {
    tenantId: string;
    bookingOrderId: string;
    durationSeconds?: number;
    actorUserId?: string | null;
  }
) {
  const reservations = await database
    .select()
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.tenantId, input.tenantId), eq(inventoryReservations.bookingOrderId, input.bookingOrderId), isNull(inventoryReservations.deletedAt)))
    .orderBy(asc(inventoryReservations.id))
    .for('update');

  if (reservations.length === 0) {
    throw badRequest('No reservations found for this booking order');
  }

  const duration = input.durationSeconds ?? 300; // default 5 minutes
  if (duration > 300) {
    throw badRequest('Maximum extension duration is 5 minutes');
  }

  const now = new Date();
  const updated = [] as Array<typeof inventoryReservations.$inferSelect>;

  for (const res of reservations) {
    if (['booked', 'converted', 'expired', 'cancelled', 'released', 'failed', 'force_released', 'refund_pending', 'refunded'].includes(res.status)) {
      throw conflict(`Cannot extend reservation in terminal status: ${res.status}`);
    }

    if (res.extensionCount >= res.maxExtensions) {
      throw conflict(`Maximum extension limit of ${res.maxExtensions} reached for reservation ${res.id}`);
    }

    const newExpiresAt = new Date(now.getTime() + duration * 1000);
    const [upd] = await database
      .update(inventoryReservations)
      .set({
        expiresAt: newExpiresAt,
        extensionCount: res.extensionCount + 1,
        status: 'payment_processing', // Transition to indicate checkout is active
        updatedAt: now,
        updatedByUserId: input.actorUserId ?? res.updatedByUserId,
        version: sql`${inventoryReservations.version} + 1`
      })
      .where(and(eq(inventoryReservations.id, res.id), eq(inventoryReservations.version, res.version)))
      .returning();

    if (upd) {
      updated.push(upd);

      await recordInventoryEvent(database, {
        tenantId: input.tenantId,
        eventId: upd.eventId,
        ticketTypeId: upd.ticketTypeId,
        reservationId: upd.id,
        bookingOrderId: input.bookingOrderId,
        eventType: 'reservation_extended',
        actorUserId: input.actorUserId,
        source: 'extend_reservation_ttl',
        previousValues: { expiresAt: res.expiresAt, extensionCount: res.extensionCount, status: res.status },
        newValues: { expiresAt: upd.expiresAt, extensionCount: upd.extensionCount, status: upd.status }
      });
    }
  }

  // Increment metrics
  const { incrementMetric } = await import('../../lib/metrics.js');
  incrementMetric('reservation_extended_total');

  return updated;
}

export default {
  getInventorySummaries,
  withDerivedInventory,
  validateAndPrepareItems,
  reserveInventoryForBookingOrder,
  reserveInventoryWithoutOrder,
  convertReservationsForBookingOrder,
  releaseReservationsForBookingOrder,
  expireDueReservations,
  reconcileCachedInventory,
  extendReservationTTL
};