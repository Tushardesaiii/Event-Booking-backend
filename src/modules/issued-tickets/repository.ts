import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { attendees, bookingOrderItems, bookingOrders, events, issuedTicketEvents, issuedTickets, ticketTypes } from '../../db/schema/index.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type { IssuedTicketListItem, IssuedTicketListQuery, IssuedTicketRecord, UpdateIssuedTicketDTO } from './types.js';

type IssuedTicketDatabase = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
  delete: typeof db.delete;
};

const issuedTicketBaseSelect = {
  id: issuedTickets.id,
  tenantId: issuedTickets.tenantId,
  eventId: issuedTickets.eventId,
  ticketTypeId: issuedTickets.ticketTypeId,
  attendeeId: issuedTickets.attendeeId,
  bookingOrderId: issuedTickets.bookingOrderId,
  bookingOrderItemId: issuedTickets.bookingOrderItemId,
  ticketNumber: issuedTickets.ticketNumber,
  qrCodeToken: issuedTickets.qrCodeToken,
  status: issuedTickets.status,
  issuedAt: issuedTickets.issuedAt,
  checkedInAt: issuedTickets.checkedInAt,
  transferredAt: issuedTickets.transferredAt,
  cancelledAt: issuedTickets.cancelledAt,
  invalidatedAt: issuedTickets.invalidatedAt,
  ticketTypeNameSnapshot: issuedTickets.ticketTypeNameSnapshot,
  ticketTypeSlugSnapshot: issuedTickets.ticketTypeSlugSnapshot,
  unitPriceSnapshot: issuedTickets.unitPriceSnapshot,
  currencySnapshot: issuedTickets.currencySnapshot,
  metadata: issuedTickets.metadata,
  checkedInByUserId: issuedTickets.checkedInByUserId,
  transferredByUserId: issuedTickets.transferredByUserId,
  lastValidatedAt: issuedTickets.lastValidatedAt,
  lastValidatedByUserId: issuedTickets.lastValidatedByUserId,
  validationCount: issuedTickets.validationCount,
  successfulValidationCount: issuedTickets.successfulValidationCount,
  failedValidationCount: issuedTickets.failedValidationCount,
  lastValidationAttemptAt: issuedTickets.lastValidationAttemptAt,
  lastSuccessfulValidationAt: issuedTickets.lastSuccessfulValidationAt,
  lastValidationFailureReason: issuedTickets.lastValidationFailureReason,
  lastValidationSource: issuedTickets.lastValidationSource,
  lastScannerDeviceId: issuedTickets.lastScannerDeviceId,
  lastScannerGate: issuedTickets.lastScannerGate,
  lastScannerOperatorUserId: issuedTickets.lastScannerOperatorUserId,
  refundedAt: issuedTickets.refundedAt,
  refundedByUserId: issuedTickets.refundedByUserId,
  createdAt: issuedTickets.createdAt,
  updatedAt: issuedTickets.updatedAt,
  deletedAt: issuedTickets.deletedAt
} as const;

const issuedTicketSelect = {
  ...issuedTicketBaseSelect,
  eventTitle: events.title,
  ticketTypeName: ticketTypes.name,
  attendeeFullName: attendees.fullName,
  attendeeEmail: attendees.email,
  bookingOrderNumber: bookingOrders.orderNumber,
  bookingOrderItemQuantity: bookingOrderItems.quantity,
  purchaserUserId: bookingOrders.purchaserUserId
} as const;

function buildWhereClause(tenantId: string, input: IssuedTicketListQuery) {
  const conditions = [eq(issuedTickets.tenantId, tenantId), isNull(issuedTickets.deletedAt)];

  if (input.eventId) {
    conditions.push(eq(issuedTickets.eventId, input.eventId));
  }

  if (input.attendeeId) {
    conditions.push(eq(issuedTickets.attendeeId, input.attendeeId));
  }

  if (input.bookingOrderId) {
    conditions.push(eq(issuedTickets.bookingOrderId, input.bookingOrderId));
  }

  if (input.bookingOrderItemId) {
    conditions.push(eq(issuedTickets.bookingOrderItemId, input.bookingOrderItemId));
  }

  if (input.ticketTypeId) {
    conditions.push(eq(issuedTickets.ticketTypeId, input.ticketTypeId));
  }

  if (input.ticketNumber) {
    conditions.push(eq(issuedTickets.ticketNumber, input.ticketNumber.trim().toUpperCase()));
  }

  if (input.status) {
    conditions.push(eq(issuedTickets.status, input.status));
  }

  if (input.checkedIn !== undefined) {
    conditions.push(input.checkedIn ? isNotNull(issuedTickets.checkedInAt) : isNull(issuedTickets.checkedInAt));
  }

  if (input.search) {
    const search = `%${input.search.trim()}%`;
    conditions.push(
      or(
        ilike(issuedTickets.ticketNumber, search),
        ilike(issuedTickets.ticketTypeNameSnapshot, search),
        ilike(issuedTickets.ticketTypeSlugSnapshot, search),
        ilike(attendees.fullName, search),
        ilike(attendees.email, search),
        ilike(bookingOrders.orderNumber, search),
        ilike(events.title, search)
      )!
    );
  }

  return and(...conditions);
}

function resolveOrderBy(input: Pick<IssuedTicketListQuery, 'sortBy' | 'sortOrder'>) {
  const direction = input.sortOrder === 'asc' ? asc : desc;

  switch (input.sortBy) {
    case 'createdAt':
      return [direction(issuedTickets.createdAt), asc(issuedTickets.ticketNumber)];
    case 'checkedInAt':
      return [direction(issuedTickets.checkedInAt), asc(issuedTickets.ticketNumber)];
    case 'ticketNumber':
      return [direction(issuedTickets.ticketNumber), asc(issuedTickets.createdAt)];
    case 'status':
      return [direction(issuedTickets.status), asc(issuedTickets.ticketNumber)];
    case 'issuedAt':
    default:
      return [direction(issuedTickets.issuedAt), asc(issuedTickets.ticketNumber)];
  }
}

function baseJoinedQuery(database: IssuedTicketDatabase) {
  return database
    .select(issuedTicketSelect)
    .from(issuedTickets)
    .leftJoin(events, and(eq(events.id, issuedTickets.eventId), isNull(events.deletedAt)))
    .leftJoin(ticketTypes, and(eq(ticketTypes.id, issuedTickets.ticketTypeId), isNull(ticketTypes.deletedAt)))
    .leftJoin(attendees, and(eq(attendees.id, issuedTickets.attendeeId), isNull(attendees.deletedAt)))
    .leftJoin(bookingOrders, and(eq(bookingOrders.id, issuedTickets.bookingOrderId), isNull(bookingOrders.deletedAt)))
    .leftJoin(bookingOrderItems, eq(bookingOrderItems.id, issuedTickets.bookingOrderItemId));
}

export async function findIssuedTicketByTenantAndTicketNumber(database: IssuedTicketDatabase, tenantId: string, ticketNumber: string) {
  const [row] = await baseJoinedQuery(database)
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.ticketNumber, ticketNumber), isNull(issuedTickets.deletedAt)))
    .limit(1);

  return row ?? null;
}

export async function findIssuedTicketByTenantAndQrCodeToken(database: IssuedTicketDatabase, tenantId: string, qrCodeToken: string) {
  const [row] = await baseJoinedQuery(database)
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.qrCodeToken, qrCodeToken), isNull(issuedTickets.deletedAt)))
    .limit(1);

  return row ?? null;
}

export async function findActiveIssuedTicketByTenantAndAttendeeId(database: IssuedTicketDatabase, tenantId: string, attendeeId: string) {
  const [row] = await baseJoinedQuery(database)
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.attendeeId, attendeeId), isNull(issuedTickets.deletedAt)))
    .limit(1);

  return row ?? null;
}

export async function findIssuedTicketsForTenant(database: IssuedTicketDatabase, tenantId: string, input: IssuedTicketListQuery, pagination: { offset: number; limit: number }) {
  const whereClause = buildWhereClause(tenantId, input);
  const orderBy = resolveOrderBy(input);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(issuedTickets)
    .leftJoin(events, and(eq(events.id, issuedTickets.eventId), isNull(events.deletedAt)))
    .leftJoin(ticketTypes, and(eq(ticketTypes.id, issuedTickets.ticketTypeId), isNull(ticketTypes.deletedAt)))
    .leftJoin(attendees, and(eq(attendees.id, issuedTickets.attendeeId), isNull(attendees.deletedAt)))
    .leftJoin(bookingOrders, and(eq(bookingOrders.id, issuedTickets.bookingOrderId), isNull(bookingOrders.deletedAt)))
    .leftJoin(bookingOrderItems, eq(bookingOrderItems.id, issuedTickets.bookingOrderItemId))
    .where(whereClause);

  const rows = await baseJoinedQuery(database)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as unknown as IssuedTicketListItem[],
    total: Number(totalRow?.total ?? 0)
  };
}

export async function findIssuedTicketsForBookingOrder(database: IssuedTicketDatabase, tenantId: string, bookingOrderId: string) {
  const rows = await baseJoinedQuery(database).where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.bookingOrderId, bookingOrderId), isNull(issuedTickets.deletedAt))).orderBy(asc(issuedTickets.ticketNumber));
  return rows as unknown as IssuedTicketListItem[];
}

export async function findIssuedTicketsForBookingOrderItem(database: IssuedTicketDatabase, tenantId: string, bookingOrderItemId: string) {
  const rows = await baseJoinedQuery(database).where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.bookingOrderItemId, bookingOrderItemId), isNull(issuedTickets.deletedAt))).orderBy(asc(issuedTickets.createdAt), asc(issuedTickets.id));
  return rows as unknown as IssuedTicketListItem[];
}

export async function createIssuedTicketRecords(
  database: IssuedTicketDatabase,
  items: Array<{
    tenantId: string;
    eventId: string;
    eventDateId: string | null;
    ticketTypeId: string;
    attendeeId: string | null;
    bookingOrderId: string;
    bookingOrderItemId: string;
    ticketNumber: string;
    qrCodeToken: string;
    status: IssuedTicketRecord['status'];
    issuedAt: Date;
    checkedInAt: Date | null;
    transferredAt: Date | null;
    cancelledAt: Date | null;
    invalidatedAt: Date | null;
    checkedInByUserId?: string | null;
    transferredByUserId?: string | null;
    lastValidatedAt?: Date | null;
    lastValidatedByUserId?: string | null;
    validationCount?: number;
    successfulValidationCount?: number;
    failedValidationCount?: number;
    lastValidationAttemptAt?: Date | null;
    lastSuccessfulValidationAt?: Date | null;
    lastValidationFailureReason?: string | null;
    lastValidationSource?: string | null;
    lastScannerDeviceId?: string | null;
    lastScannerGate?: string | null;
    lastScannerOperatorUserId?: string | null;
    refundedAt?: Date | null;
    refundedByUserId?: string | null;
    ticketTypeNameSnapshot: string;
    ticketTypeSlugSnapshot: string;
    unitPriceSnapshot: string;
    currencySnapshot: string;
    metadata: Record<string, unknown>;
  }>
) {
  if (items.length === 0) {
    return [];
  }

  const rows = await database.insert(issuedTickets).values(items).returning(issuedTicketBaseSelect);
  return rows;
}

export async function updateIssuedTicketRecord(
  database: IssuedTicketDatabase,
  tenantId: string,
  ticketNumber: string,
  input: Omit<UpdateIssuedTicketDTO, 'attendeeId'> & {
    attendeeId?: string | null;
    updatedByUserId?: string;
    checkedInAt?: Date | null | undefined;
    transferredAt?: Date | null | undefined;
    cancelledAt?: Date | null | undefined;
    invalidatedAt?: Date | null | undefined;
    checkedInByUserId?: string | null | undefined;
    transferredByUserId?: string | null | undefined;
    lastValidatedAt?: Date | null | undefined;
    lastValidatedByUserId?: string | null | undefined;
    validationCountIncrement?: number | undefined;
    successfulValidationCountIncrement?: number | undefined;
    failedValidationCountIncrement?: number | undefined;
    lastValidationAttemptAt?: Date | null | undefined;
    lastSuccessfulValidationAt?: Date | null | undefined;
    lastValidationFailureReason?: string | null | undefined;
    lastValidationSource?: string | null | undefined;
    lastScannerDeviceId?: string | null | undefined;
    lastScannerGate?: string | null | undefined;
    lastScannerOperatorUserId?: string | null | undefined;
    refundedAt?: Date | null | undefined;
    refundedByUserId?: string | null | undefined;
    status: IssuedTicketRecord['status'];
  }
) {
  const [row] = await database
    .update(issuedTickets)
    .set({
      ...(input.attendeeId === undefined ? {} : { attendeeId: input.attendeeId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.checkedInAt === undefined ? {} : { checkedInAt: input.checkedInAt }),
      ...(input.checkedInByUserId === undefined ? {} : { checkedInByUserId: input.checkedInByUserId }),
      ...(input.transferredAt === undefined ? {} : { transferredAt: input.transferredAt }),
      ...(input.transferredByUserId === undefined ? {} : { transferredByUserId: input.transferredByUserId }),
      ...(input.cancelledAt === undefined ? {} : { cancelledAt: input.cancelledAt }),
      ...(input.invalidatedAt === undefined ? {} : { invalidatedAt: input.invalidatedAt }),
      ...(input.lastValidatedAt === undefined ? {} : { lastValidatedAt: input.lastValidatedAt }),
      ...(input.lastValidatedByUserId === undefined ? {} : { lastValidatedByUserId: input.lastValidatedByUserId }),
      ...(input.validationCountIncrement === undefined ? {} : { validationCount: sql`${issuedTickets.validationCount} + ${input.validationCountIncrement}` }),
      ...(input.successfulValidationCountIncrement === undefined ? {} : { successfulValidationCount: sql`${issuedTickets.successfulValidationCount} + ${input.successfulValidationCountIncrement}` }),
      ...(input.failedValidationCountIncrement === undefined ? {} : { failedValidationCount: sql`${issuedTickets.failedValidationCount} + ${input.failedValidationCountIncrement}` }),
      ...(input.lastValidationAttemptAt === undefined ? {} : { lastValidationAttemptAt: input.lastValidationAttemptAt }),
      ...(input.lastSuccessfulValidationAt === undefined ? {} : { lastSuccessfulValidationAt: input.lastSuccessfulValidationAt }),
      ...(input.lastValidationFailureReason === undefined ? {} : { lastValidationFailureReason: input.lastValidationFailureReason }),
      ...(input.lastValidationSource === undefined ? {} : { lastValidationSource: input.lastValidationSource }),
      ...(input.lastScannerDeviceId === undefined ? {} : { lastScannerDeviceId: input.lastScannerDeviceId }),
      ...(input.lastScannerGate === undefined ? {} : { lastScannerGate: input.lastScannerGate }),
      ...(input.lastScannerOperatorUserId === undefined ? {} : { lastScannerOperatorUserId: input.lastScannerOperatorUserId }),
      ...(input.refundedAt === undefined ? {} : { refundedAt: input.refundedAt }),
      ...(input.refundedByUserId === undefined ? {} : { refundedByUserId: input.refundedByUserId }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      updatedAt: new Date()
    })
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.ticketNumber, ticketNumber), optimisticLockCondition(issuedTickets.updatedAt, input.lastKnownUpdatedAt), isNull(issuedTickets.deletedAt)))
    .returning(issuedTicketBaseSelect);

  return row ?? null;
}

export async function softDeleteIssuedTicketRecord(database: IssuedTicketDatabase, tenantId: string, ticketNumber: string, lastKnownUpdatedAt: string, invalidatedAt: Date | null) {
  const [row] = await database
    .update(issuedTickets)
    .set({
      status: 'invalidated',
      invalidatedAt: invalidatedAt ?? new Date(),
      updatedAt: new Date(),
      deletedAt: new Date()
    })
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.ticketNumber, ticketNumber), optimisticLockCondition(issuedTickets.updatedAt, lastKnownUpdatedAt), isNull(issuedTickets.deletedAt)))
    .returning(issuedTicketBaseSelect);

  return row ?? null;
}

export async function recordIssuedTicketValidation(database: IssuedTicketDatabase, tenantId: string, ticketNumber: string, validatedByUserId: string | null) {
  const [row] = await database
    .update(issuedTickets)
    .set({
      lastValidatedAt: new Date(),
      lastValidatedByUserId: validatedByUserId,
      validationCount: sql`${issuedTickets.validationCount} + 1`,
      updatedAt: new Date()
    })
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.ticketNumber, ticketNumber), isNull(issuedTickets.deletedAt)))
    .returning(issuedTicketBaseSelect);

  return row ?? null;
}

export async function recordIssuedTicketValidationAttempt(
  database: IssuedTicketDatabase,
  tenantId: string,
  ticketNumber: string,
  input: {
    outcome: 'valid' | 'already_checked_in' | 'cancelled' | 'invalidated' | 'refunded' | 'deleted' | 'tenant_mismatch' | 'stale_ticket' | 'invalid_qr' | 'unauthorized_scanner';
    validatedByUserId?: string | null;
    scannerDeviceId?: string | null;
    scannerGate?: string | null;
    scannerOperatorUserId?: string | null;
    source?: string | null;
    failureReason?: string | null;
    success?: boolean;
  }
) {
  const now = new Date();

  const [row] = await database
    .update(issuedTickets)
    .set({
      validationCount: sql`${issuedTickets.validationCount} + 1`,
      ...(input.success ? { successfulValidationCount: sql`${issuedTickets.successfulValidationCount} + 1` } : { failedValidationCount: sql`${issuedTickets.failedValidationCount} + 1` }),
      lastValidationAttemptAt: now,
      ...(input.success ? { lastSuccessfulValidationAt: now } : {}),
      ...(input.success ? { lastValidatedAt: now } : {}),
      ...(input.success ? { lastValidatedByUserId: input.validatedByUserId ?? null } : {}),
      ...(input.success ? { lastValidationFailureReason: null } : { lastValidationFailureReason: input.failureReason ?? input.outcome }),
      ...(input.source === undefined ? {} : { lastValidationSource: input.source }),
      ...(input.scannerDeviceId === undefined ? {} : { lastScannerDeviceId: input.scannerDeviceId }),
      ...(input.scannerGate === undefined ? {} : { lastScannerGate: input.scannerGate }),
      ...(input.scannerOperatorUserId === undefined ? {} : { lastScannerOperatorUserId: input.scannerOperatorUserId }),
      updatedAt: now
    })
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.ticketNumber, ticketNumber), isNull(issuedTickets.deletedAt)))
    .returning(issuedTicketBaseSelect);

  return row ?? null;
}

export async function findIssuedTicketsByTicketNumber(database: IssuedTicketDatabase, ticketNumber: string) {
  const rows = await baseJoinedQuery(database).where(eq(issuedTickets.ticketNumber, ticketNumber));
  return rows as unknown as IssuedTicketListItem[];
}

export async function findIssuedTicketByQrCodeToken(database: IssuedTicketDatabase, qrCodeToken: string) {
  const [row] = await baseJoinedQuery(database).where(eq(issuedTickets.qrCodeToken, qrCodeToken)).limit(1);
  return row ?? null;
}

export async function insertIssuedTicketEventRecord(
  database: IssuedTicketDatabase,
  input: {
    tenantId: string;
    issuedTicketId?: string | null;
    eventType: 'ticket_validated' | 'ticket_checked_in' | 'ticket_invalidated' | 'ticket_refunded' | 'ticket_cancelled' | 'ticket_transferred' | 'ticket_validation_rejected';
    outcome: 'valid' | 'already_checked_in' | 'cancelled' | 'invalidated' | 'refunded' | 'deleted' | 'tenant_mismatch' | 'stale_ticket' | 'invalid_qr' | 'unauthorized_scanner';
    actorUserId?: string | null;
    scannerDeviceId?: string | null;
    scannerGate?: string | null;
    scannerOperatorUserId?: string | null;
    source?: string | null;
    details?: Record<string, unknown>;
  }
) {
  const [row] = await database
    .insert(issuedTicketEvents)
    .values({
      tenantId: input.tenantId,
      issuedTicketId: input.issuedTicketId ?? null,
      eventType: input.eventType,
      outcome: input.outcome,
      actorUserId: input.actorUserId ?? null,
      scannerDeviceId: input.scannerDeviceId ?? null,
      scannerGate: input.scannerGate ?? null,
      scannerOperatorUserId: input.scannerOperatorUserId ?? null,
      source: input.source ?? null,
      details: input.details ?? {}
    })
    .returning({ id: issuedTicketEvents.id });

  return row ?? null;
}

export async function countIssuedTicketsForBookingOrderItem(database: IssuedTicketDatabase, tenantId: string, bookingOrderItemId: string) {
  const [row] = await database
    .select({ total: sql<number>`count(*)` })
    .from(issuedTickets)
    .where(and(eq(issuedTickets.tenantId, tenantId), eq(issuedTickets.bookingOrderItemId, bookingOrderItemId), isNull(issuedTickets.deletedAt)));

  return Number(row?.total ?? 0);
}

function isNotNull<T>(value: T) {
  return sql`${value} is not null`;
}
