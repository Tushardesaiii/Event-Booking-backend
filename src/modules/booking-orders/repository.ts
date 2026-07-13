import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { bookingOrderCounters, bookingOrderItemAttendees, bookingOrderItems, bookingOrders } from '../../db/schema/index.js';
import { events } from '../../db/schema/events.js';
import { attendees } from '../../db/schema/attendees.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import { users } from '../../db/schema/users.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type { BookingOrderAttendeesQuery, BookingOrderListItem, BookingOrderListQuery, CreateBookingOrderDTO, UpdateBookingOrderDTO } from './types.js';

type BookingDatabase = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
};

const bookingOrderSelect = {
  id: bookingOrders.id,
  tenantId: bookingOrders.tenantId,
  eventId: bookingOrders.eventId,
  eventDateId: bookingOrders.eventDateId,
  purchaserUserId: bookingOrders.purchaserUserId,
  orderNumber: bookingOrders.orderNumber,
  status: bookingOrders.status,
  currency: bookingOrders.currency,
  subtotalAmount: bookingOrders.subtotalAmount,
  taxAmount: bookingOrders.taxAmount,
  discountAmount: bookingOrders.discountAmount,
  totalAmount: bookingOrders.totalAmount,
  source: bookingOrders.source,
  notes: bookingOrders.notes,
  expiresAt: bookingOrders.expiresAt,
  confirmedAt: bookingOrders.confirmedAt,
  cancelledAt: bookingOrders.cancelledAt,
  cancellationReason: bookingOrders.cancellationReason,
  metadata: bookingOrders.metadata,
  createdByUserId: bookingOrders.createdByUserId,
  updatedByUserId: bookingOrders.updatedByUserId,
  createdAt: bookingOrders.createdAt,
  updatedAt: bookingOrders.updatedAt,
  deletedAt: bookingOrders.deletedAt,
  eventTitle: events.title,
  purchaserFullName: users.fullName,
  purchaserUsername: users.username
} as const;

const bookingOrderItemSelect = {
  id: bookingOrderItems.id,
  tenantId: bookingOrderItems.tenantId,
  bookingOrderId: bookingOrderItems.bookingOrderId,
  ticketTypeId: bookingOrderItems.ticketTypeId,
  quantity: bookingOrderItems.quantity,
  unitPrice: bookingOrderItems.unitPrice,
  subtotalAmount: bookingOrderItems.subtotalAmount,
  taxAmount: bookingOrderItems.taxAmount,
  totalAmount: bookingOrderItems.totalAmount,
  currency: bookingOrderItems.currency,
  ticketNameSnapshot: bookingOrderItems.ticketNameSnapshot,
  ticketSlugSnapshot: bookingOrderItems.ticketSlugSnapshot,
  metadata: bookingOrderItems.metadata,
  createdAt: bookingOrderItems.createdAt,
  updatedAt: bookingOrderItems.updatedAt
} as const;

const bookingOrderAttendeeSelect = {
  id: bookingOrderItemAttendees.id,
  tenantId: bookingOrderItemAttendees.tenantId,
  bookingOrderId: bookingOrderItemAttendees.bookingOrderId,
  bookingOrderItemId: bookingOrderItemAttendees.bookingOrderItemId,
  attendeeId: bookingOrderItemAttendees.attendeeId,
  assignedAt: bookingOrderItemAttendees.assignedAt,
  assignedByUserId: bookingOrderItemAttendees.assignedByUserId,
  createdAt: bookingOrderItemAttendees.createdAt,
  updatedAt: bookingOrderItemAttendees.updatedAt,
  deletedAt: bookingOrderItemAttendees.deletedAt,
  attendeeFullName: attendees.fullName,
  attendeeEmail: attendees.email,
  attendeePhone: attendees.phone,
  attendeeStatus: attendees.status,
  ticketTypeNameSnapshot: bookingOrderItems.ticketNameSnapshot,
  ticketTypeSlugSnapshot: bookingOrderItems.ticketSlugSnapshot
} as const;

function buildOrderWhereClause(tenantId: string, input: BookingOrderListQuery) {
  const conditions = [eq(bookingOrders.tenantId, tenantId), isNull(bookingOrders.deletedAt)];

  if (input.status) {
    conditions.push(eq(bookingOrders.status, input.status));
  }

  if (input.eventId) {
    conditions.push(eq(bookingOrders.eventId, input.eventId));
  }

  if (input.purchaserUserId) {
    conditions.push(eq(bookingOrders.purchaserUserId, input.purchaserUserId));
  }

  if (input.source) {
    conditions.push(eq(bookingOrders.source, input.source));
  }

  if (input.orderNumber) {
    conditions.push(eq(bookingOrders.orderNumber, input.orderNumber.trim().toUpperCase()));
  }

  if (input.createdFrom) {
    conditions.push(gte(bookingOrders.createdAt, new Date(input.createdFrom)));
  }

  if (input.createdTo) {
    conditions.push(lte(bookingOrders.createdAt, new Date(input.createdTo)));
  }

  if (input.search) {
    const search = `%${input.search.trim()}%`;
    conditions.push(
      or(
        ilike(bookingOrders.orderNumber, search),
        ilike(bookingOrders.notes, search),
        ilike(events.title, search),
        ilike(users.fullName, search),
        ilike(users.username, search)
      )!
    );
  }

  if (input.attendeeEmail) {
    conditions.push(
      sql`exists (
        select 1
        from booking_order_item_attendees boia
        join attendees a on a.id = boia.attendee_id and a.deleted_at is null
        where boia.booking_order_id = ${bookingOrders.id}
          and boia.tenant_id = ${tenantId}
          and boia.deleted_at is null
          and a.email = ${input.attendeeEmail}
      )`
    );
  }

  if (input.attendeePhone) {
    conditions.push(
      sql`exists (
        select 1
        from booking_order_item_attendees boia
        join attendees a on a.id = boia.attendee_id and a.deleted_at is null
        where boia.booking_order_id = ${bookingOrders.id}
          and boia.tenant_id = ${tenantId}
          and boia.deleted_at is null
          and a.phone = ${input.attendeePhone.trim()}
      )`
    );
  }

  return and(...conditions);
}

function resolveOrderBy(input: Pick<BookingOrderListQuery, 'sortBy' | 'sortOrder'>) {
  const direction = input.sortOrder === 'asc' ? asc : desc;

  switch (input.sortBy) {
    case 'updatedAt':
      return [direction(bookingOrders.updatedAt), asc(bookingOrders.orderNumber)];
    case 'confirmedAt':
      return [direction(bookingOrders.confirmedAt), asc(bookingOrders.orderNumber)];
    case 'totalAmount':
      return [direction(bookingOrders.totalAmount), asc(bookingOrders.orderNumber)];
    case 'orderNumber':
      return [direction(bookingOrders.orderNumber), asc(bookingOrders.createdAt)];
    case 'createdAt':
    default:
      return [direction(bookingOrders.createdAt), asc(bookingOrders.orderNumber)];
  }
}

function buildOrderItemWhereClause(tenantId: string, orderId: string) {
  return and(eq(bookingOrderItems.tenantId, tenantId), eq(bookingOrderItems.bookingOrderId, orderId));
}

function buildAssignmentWhereClause(tenantId: string, orderId: string) {
  return and(eq(bookingOrderItemAttendees.tenantId, tenantId), eq(bookingOrderItemAttendees.bookingOrderId, orderId), isNull(bookingOrderItemAttendees.deletedAt));
}

export async function findUserById(database: BookingDatabase, userId: string) {
  const [user] = await database
    .select({ id: users.id, fullName: users.fullName, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function findEventByTenantAndId(database: BookingDatabase, tenantId: string, eventId: string) {
  const [event] = await database
    .select({ id: events.id, tenantId: events.tenantId, title: events.title, slug: events.slug, status: events.status, deletedAt: events.deletedAt })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .limit(1);

  return event ?? null;
}

export async function findBookingOrderByTenantAndOrderNumber(database: BookingDatabase, tenantId: string, orderNumber: string) {
  const [order] = await database
    .select(bookingOrderSelect)
    .from(bookingOrders)
    .leftJoin(events, and(eq(events.id, bookingOrders.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .leftJoin(users, eq(users.id, bookingOrders.purchaserUserId))
    .where(and(eq(bookingOrders.tenantId, tenantId), eq(bookingOrders.orderNumber, orderNumber), isNull(bookingOrders.deletedAt)))
    .limit(1);

  return order ?? null;
}

export async function findBookingOrderById(database: BookingDatabase, tenantId: string, orderId: string) {
  const [order] = await database
    .select(bookingOrderSelect)
    .from(bookingOrders)
    .leftJoin(events, and(eq(events.id, bookingOrders.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .leftJoin(users, eq(users.id, bookingOrders.purchaserUserId))
    .where(and(eq(bookingOrders.tenantId, tenantId), eq(bookingOrders.id, orderId), isNull(bookingOrders.deletedAt)))
    .limit(1);

  return order ?? null;
}

export async function listBookingOrdersForTenant(
  database: BookingDatabase,
  tenantId: string,
  input: BookingOrderListQuery,
  pagination: { offset: number; limit: number }
) {
  const whereClause = buildOrderWhereClause(tenantId, input);
  const orderBy = resolveOrderBy(input);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(bookingOrders)
    .leftJoin(events, and(eq(events.id, bookingOrders.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .leftJoin(users, eq(users.id, bookingOrders.purchaserUserId))
    .where(whereClause);

  const rows = await database
    .select(bookingOrderSelect)
    .from(bookingOrders)
    .leftJoin(events, and(eq(events.id, bookingOrders.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .leftJoin(users, eq(users.id, bookingOrders.purchaserUserId))
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as unknown as BookingOrderListItem[],
    total: Number(totalRow?.total ?? 0)
  };
}

export async function createBookingOrderRecord(
  database: BookingDatabase,
  input: Omit<CreateBookingOrderDTO, 'items'> & {
    tenantId: string;
    orderNumber: string;
    currency: string;
    subtotalAmount: string;
    taxAmount: string;
    totalAmount: string;
    confirmedAt: Date | null;
    createdByUserId: string;
    metadata: Record<string, unknown>;
  }
) {
  const [order] = await database
    .insert(bookingOrders)
    .values({
      tenantId: input.tenantId,
      eventId: input.eventId,
      eventDateId: input.eventDateId ?? null,
      purchaserUserId: input.purchaserUserId,
      orderNumber: input.orderNumber,
      status: input.status,
      currency: input.currency,
      subtotalAmount: input.subtotalAmount,
      taxAmount: input.taxAmount,
      discountAmount: String(input.discountAmount),
      totalAmount: input.totalAmount,
      source: input.source,
      notes: input.notes ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      confirmedAt: input.confirmedAt,
      cancelledAt: null,
      cancellationReason: null,
      metadata: input.metadata,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.createdByUserId
    })
    .returning({
      id: bookingOrders.id,
      orderNumber: bookingOrders.orderNumber,
      tenantId: bookingOrders.tenantId,
      eventId: bookingOrders.eventId,
      purchaserUserId: bookingOrders.purchaserUserId,
      status: bookingOrders.status,
      currency: bookingOrders.currency,
      subtotalAmount: bookingOrders.subtotalAmount,
      taxAmount: bookingOrders.taxAmount,
      discountAmount: bookingOrders.discountAmount,
      totalAmount: bookingOrders.totalAmount,
      source: bookingOrders.source,
      notes: bookingOrders.notes,
      expiresAt: bookingOrders.expiresAt,
      confirmedAt: bookingOrders.confirmedAt,
      cancelledAt: bookingOrders.cancelledAt,
      cancellationReason: bookingOrders.cancellationReason,
      metadata: bookingOrders.metadata,
      createdByUserId: bookingOrders.createdByUserId,
      updatedByUserId: bookingOrders.updatedByUserId,
      createdAt: bookingOrders.createdAt,
      updatedAt: bookingOrders.updatedAt,
      deletedAt: bookingOrders.deletedAt
    });

  return order ?? null;
}

export async function updateBookingOrderRecord(
  database: BookingDatabase,
  tenantId: string,
  orderNumber: string,
  input: Omit<UpdateBookingOrderDTO, 'discountAmount'> & {
    updatedByUserId: string;
    confirmedAt: Date | null | undefined;
    cancelledAt: Date | null | undefined;
    totalAmount: string;
    subtotalAmount: string;
    taxAmount: string;
    discountAmount: string;
  }
) {
  const [order] = await database
    .update(bookingOrders)
    .set({
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.discountAmount === undefined ? {} : { discountAmount: String(input.discountAmount) }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.cancellationReason === undefined ? {} : { cancellationReason: input.cancellationReason }),
      subtotalAmount: input.subtotalAmount,
      taxAmount: input.taxAmount,
      totalAmount: input.totalAmount,
      confirmedAt: input.confirmedAt,
      cancelledAt: input.cancelledAt,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date()
    })
    .where(and(eq(bookingOrders.tenantId, tenantId), eq(bookingOrders.orderNumber, orderNumber), optimisticLockCondition(bookingOrders.updatedAt, input.lastKnownUpdatedAt), isNull(bookingOrders.deletedAt)))
    .returning({
      id: bookingOrders.id,
      orderNumber: bookingOrders.orderNumber,
      tenantId: bookingOrders.tenantId,
      eventId: bookingOrders.eventId,
      purchaserUserId: bookingOrders.purchaserUserId,
      status: bookingOrders.status,
      currency: bookingOrders.currency,
      subtotalAmount: bookingOrders.subtotalAmount,
      taxAmount: bookingOrders.taxAmount,
      discountAmount: bookingOrders.discountAmount,
      totalAmount: bookingOrders.totalAmount,
      source: bookingOrders.source,
      notes: bookingOrders.notes,
      expiresAt: bookingOrders.expiresAt,
      confirmedAt: bookingOrders.confirmedAt,
      cancelledAt: bookingOrders.cancelledAt,
      cancellationReason: bookingOrders.cancellationReason,
      metadata: bookingOrders.metadata,
      createdByUserId: bookingOrders.createdByUserId,
      updatedByUserId: bookingOrders.updatedByUserId,
      createdAt: bookingOrders.createdAt,
      updatedAt: bookingOrders.updatedAt,
      deletedAt: bookingOrders.deletedAt
    });

  return order ?? null;
}

export async function softDeleteBookingOrderRecord(
  database: BookingDatabase,
  tenantId: string,
  orderNumber: string,
  updatedByUserId: string,
  lastKnownUpdatedAt: string,
  cancelledAt: Date | null
) {
  const [order] = await database
    .update(bookingOrders)
    .set({
      updatedByUserId,
      updatedAt: new Date(),
      deletedAt: new Date(),
      cancelledAt: cancelledAt ?? new Date(),
      status: 'cancelled'
    })
    .where(and(eq(bookingOrders.tenantId, tenantId), eq(bookingOrders.orderNumber, orderNumber), optimisticLockCondition(bookingOrders.updatedAt, lastKnownUpdatedAt), isNull(bookingOrders.deletedAt)))
    .returning({
      id: bookingOrders.id,
      orderNumber: bookingOrders.orderNumber,
      tenantId: bookingOrders.tenantId,
      eventId: bookingOrders.eventId,
      purchaserUserId: bookingOrders.purchaserUserId,
      status: bookingOrders.status,
      currency: bookingOrders.currency,
      subtotalAmount: bookingOrders.subtotalAmount,
      taxAmount: bookingOrders.taxAmount,
      discountAmount: bookingOrders.discountAmount,
      totalAmount: bookingOrders.totalAmount,
      source: bookingOrders.source,
      notes: bookingOrders.notes,
      expiresAt: bookingOrders.expiresAt,
      confirmedAt: bookingOrders.confirmedAt,
      cancelledAt: bookingOrders.cancelledAt,
      cancellationReason: bookingOrders.cancellationReason,
      metadata: bookingOrders.metadata,
      createdByUserId: bookingOrders.createdByUserId,
      updatedByUserId: bookingOrders.updatedByUserId,
      createdAt: bookingOrders.createdAt,
      updatedAt: bookingOrders.updatedAt,
      deletedAt: bookingOrders.deletedAt
    });

  return order ?? null;
}

export async function createBookingOrderItemRecords(
  database: BookingDatabase,
  items: Array<{
    tenantId: string;
    bookingOrderId: string;
    ticketTypeId: string;
    quantity: number;
    unitPrice: string;
    subtotalAmount: string;
    taxAmount: string;
    totalAmount: string;
    currency: string;
    ticketNameSnapshot: string;
    ticketSlugSnapshot: string;
    metadata: Record<string, unknown>;
  }>
) {
  if (items.length === 0) {
    return [];
  }

  const rows = await database.insert(bookingOrderItems).values(items).returning(bookingOrderItemSelect);
  return rows;
}

export async function findBookingOrderItemsForOrder(database: BookingDatabase, tenantId: string, orderId: string) {
  const rows = await database
    .select(bookingOrderItemSelect)
    .from(bookingOrderItems)
    .where(buildOrderItemWhereClause(tenantId, orderId))
    .orderBy(asc(bookingOrderItems.createdAt), asc(bookingOrderItems.id));

  return rows;
}

export async function findBookingOrderItemById(database: BookingDatabase, tenantId: string, bookingOrderItemId: string) {
  const [row] = await database
    .select(bookingOrderItemSelect)
    .from(bookingOrderItems)
    .where(and(eq(bookingOrderItems.tenantId, tenantId), eq(bookingOrderItems.id, bookingOrderItemId)))
    .limit(1);

  return row ?? null;
}

export async function createBookingOrderItemAssignmentRecord(
  database: BookingDatabase,
  input: {
    tenantId: string;
    bookingOrderId: string;
    bookingOrderItemId: string;
    attendeeId: string;
    assignedByUserId: string;
  }
) {
  const [assignment] = await database
    .insert(bookingOrderItemAttendees)
    .values({
      tenantId: input.tenantId,
      bookingOrderId: input.bookingOrderId,
      bookingOrderItemId: input.bookingOrderItemId,
      attendeeId: input.attendeeId,
      assignedByUserId: input.assignedByUserId
    })
    .returning({
      id: bookingOrderItemAttendees.id,
      tenantId: bookingOrderItemAttendees.tenantId,
      bookingOrderId: bookingOrderItemAttendees.bookingOrderId,
      bookingOrderItemId: bookingOrderItemAttendees.bookingOrderItemId,
      attendeeId: bookingOrderItemAttendees.attendeeId,
      assignedAt: bookingOrderItemAttendees.assignedAt,
      assignedByUserId: bookingOrderItemAttendees.assignedByUserId,
      createdAt: bookingOrderItemAttendees.createdAt,
      updatedAt: bookingOrderItemAttendees.updatedAt,
      deletedAt: bookingOrderItemAttendees.deletedAt
    });

  return assignment ?? null;
}

export async function softDeleteBookingOrderItemAssignmentRecord(
  database: BookingDatabase,
  tenantId: string,
  attendeeId: string
) {
  const [assignment] = await database
    .update(bookingOrderItemAttendees)
    .set({ updatedAt: new Date(), deletedAt: new Date() })
    .where(and(eq(bookingOrderItemAttendees.tenantId, tenantId), eq(bookingOrderItemAttendees.attendeeId, attendeeId), isNull(bookingOrderItemAttendees.deletedAt)))
    .returning(bookingOrderAttendeeSelect);

  return assignment ?? null;
}

export async function findBookingOrderAttendeesForOrder(database: BookingDatabase, tenantId: string, orderId: string) {
  const rows = await database
    .select(bookingOrderAttendeeSelect)
    .from(bookingOrderItemAttendees)
    .innerJoin(attendees, eq(attendees.id, bookingOrderItemAttendees.attendeeId))
    .innerJoin(bookingOrderItems, eq(bookingOrderItems.id, bookingOrderItemAttendees.bookingOrderItemId))
    .where(buildAssignmentWhereClause(tenantId, orderId))
    .orderBy(asc(bookingOrderItemAttendees.assignedAt), asc(bookingOrderItemAttendees.id));

  return rows;
}

export async function countActiveAssignmentsForItem(database: BookingDatabase, tenantId: string, bookingOrderItemId: string) {
  const [row] = await database
    .select({ total: sql<number>`count(*)` })
    .from(bookingOrderItemAttendees)
    .where(and(eq(bookingOrderItemAttendees.tenantId, tenantId), eq(bookingOrderItemAttendees.bookingOrderItemId, bookingOrderItemId), isNull(bookingOrderItemAttendees.deletedAt)));

  return Number(row?.total ?? 0);
}

export async function countActiveAssignmentsForOrder(database: BookingDatabase, tenantId: string, orderId: string) {
  const [row] = await database
    .select({ total: sql<number>`count(*)` })
    .from(bookingOrderItemAttendees)
    .where(and(eq(bookingOrderItemAttendees.tenantId, tenantId), eq(bookingOrderItemAttendees.bookingOrderId, orderId), isNull(bookingOrderItemAttendees.deletedAt)));

  return Number(row?.total ?? 0);
}

export async function findActiveAssignmentForAttendee(database: BookingDatabase, tenantId: string, attendeeId: string) {
  const [assignment] = await database
    .select(bookingOrderAttendeeSelect)
    .from(bookingOrderItemAttendees)
    .innerJoin(attendees, eq(attendees.id, bookingOrderItemAttendees.attendeeId))
    .innerJoin(bookingOrderItems, eq(bookingOrderItems.id, bookingOrderItemAttendees.bookingOrderItemId))
    .where(and(eq(bookingOrderItemAttendees.tenantId, tenantId), eq(bookingOrderItemAttendees.attendeeId, attendeeId), isNull(bookingOrderItemAttendees.deletedAt)))
    .limit(1);

  return assignment ?? null;
}

export async function findBookingOrderCounterByTenantEventYear(database: BookingDatabase, tenantId: string, eventId: string, year: number) {
  const [row] = await database
    .select({ id: bookingOrderCounters.id, tenantId: bookingOrderCounters.tenantId, eventId: bookingOrderCounters.eventId, year: bookingOrderCounters.year, prefix: bookingOrderCounters.prefix, nextSequence: bookingOrderCounters.nextSequence })
    .from(bookingOrderCounters)
    .where(and(eq(bookingOrderCounters.tenantId, tenantId), eq(bookingOrderCounters.eventId, eventId), eq(bookingOrderCounters.year, year)))
    .limit(1);

  return row ?? null;
}