import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { attendees } from '../../db/schema/attendees.js';
import { events } from '../../db/schema/events.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type { AttendeeDetailItem, AttendeeListQuery, AttendeeRecord, CreateAttendeeDTO, UpdateAttendeeDTO } from './types.js';

type AttendeeDatabase = Pick<typeof db, 'select' | 'insert' | 'update'>;

const attendeeSelect = {
  id: attendees.id,
  tenantId: attendees.tenantId,
  eventId: attendees.eventId,
  ticketTypeId: attendees.ticketTypeId,
  bookingOrderId: attendees.bookingOrderId,
  fullName: attendees.fullName,
  email: attendees.email,
  phone: attendees.phone,
  gender: attendees.gender,
  dateOfBirth: attendees.dateOfBirth,
  city: attendees.city,
  state: attendees.state,
  country: attendees.country,
  emergencyContactName: attendees.emergencyContactName,
  emergencyContactPhone: attendees.emergencyContactPhone,
  notes: attendees.notes,
  checkedInAt: attendees.checkedInAt,
  checkedInByUserId: attendees.checkedInByUserId,
  status: attendees.status,
  createdByUserId: attendees.createdByUserId,
  updatedByUserId: attendees.updatedByUserId,
  createdAt: attendees.createdAt,
  updatedAt: attendees.updatedAt,
  deletedAt: attendees.deletedAt,
  eventTitle: events.title,
  ticketTypeName: ticketTypes.name
} as const;

const attendeeCoreSelect = {
  id: attendees.id,
  tenantId: attendees.tenantId,
  eventId: attendees.eventId,
  ticketTypeId: attendees.ticketTypeId,
  bookingOrderId: attendees.bookingOrderId,
  fullName: attendees.fullName,
  email: attendees.email,
  phone: attendees.phone,
  gender: attendees.gender,
  dateOfBirth: attendees.dateOfBirth,
  city: attendees.city,
  state: attendees.state,
  country: attendees.country,
  emergencyContactName: attendees.emergencyContactName,
  emergencyContactPhone: attendees.emergencyContactPhone,
  notes: attendees.notes,
  checkedInAt: attendees.checkedInAt,
  checkedInByUserId: attendees.checkedInByUserId,
  status: attendees.status,
  createdByUserId: attendees.createdByUserId,
  updatedByUserId: attendees.updatedByUserId,
  createdAt: attendees.createdAt,
  updatedAt: attendees.updatedAt,
  deletedAt: attendees.deletedAt
} as const;

function buildWhereClause(tenantId: string, input: AttendeeListQuery) {
  const conditions = [eq(attendees.tenantId, tenantId), isNull(attendees.deletedAt)];

  if (input.eventId) {
    conditions.push(eq(attendees.eventId, input.eventId));
  }

  if (input.ticketTypeId) {
    conditions.push(eq(attendees.ticketTypeId, input.ticketTypeId));
  }

  if (input.status) {
    conditions.push(eq(attendees.status, input.status));
  }

  if (input.checkedIn !== undefined) {
    conditions.push(input.checkedIn ? isNotNull(attendees.checkedInAt) : isNull(attendees.checkedInAt));
  }

  if (input.city) {
    conditions.push(ilike(attendees.city, input.city.trim()));
  }

  if (input.search) {
    const search = `%${input.search.trim()}%`;
    conditions.push(or(ilike(attendees.fullName, search), ilike(attendees.email, search), ilike(attendees.phone, search))!);
  }

  return and(...conditions);
}

function resolveOrderBy(input: Pick<AttendeeListQuery, 'sortBy' | 'sortOrder'>) {
  const direction = input.sortOrder === 'asc' ? asc : desc;

  switch (input.sortBy) {
    case 'checkedInAt':
      return [direction(attendees.checkedInAt), asc(attendees.fullName), asc(attendees.id)];
    case 'fullName':
      return [direction(attendees.fullName), asc(attendees.id)];
    case 'createdAt':
    default:
      return [direction(attendees.createdAt), asc(attendees.id)];
  }
}

function attendeeQuerySelect() {
  return attendeeSelect;
}

export async function findActiveEventByTenantAndId(database: AttendeeDatabase, tenantId: string, eventId: string) {
  const [event] = await database
    .select({ id: events.id, tenantId: events.tenantId })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .limit(1);

  return event ?? null;
}

export async function findActiveTicketTypeByTenantAndId(database: AttendeeDatabase, tenantId: string, ticketTypeId: string) {
  const [ticketType] = await database
    .select({ id: ticketTypes.id, tenantId: ticketTypes.tenantId, eventId: ticketTypes.eventId })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.id, ticketTypeId), eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)))
    .limit(1);

  return ticketType ?? null;
}

export async function findAttendeeByTenantAndId(database: AttendeeDatabase, tenantId: string, attendeeId: string) {
  const [attendee] = await database
    .select(attendeeQuerySelect())
    .from(attendees)
    .leftJoin(events, eq(events.id, attendees.eventId))
    .leftJoin(ticketTypes, eq(ticketTypes.id, attendees.ticketTypeId))
    .where(and(eq(attendees.tenantId, tenantId), eq(attendees.id, attendeeId), isNull(attendees.deletedAt)))
    .limit(1);

  return attendee ?? null;
}

export async function listAttendeesForTenant(
  database: AttendeeDatabase,
  tenantId: string,
  input: AttendeeListQuery,
  pagination: { offset: number; limit: number }
) {
  const whereClause = buildWhereClause(tenantId, input);
  const orderBy = resolveOrderBy(input);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(attendees)
    .leftJoin(events, eq(events.id, attendees.eventId))
    .leftJoin(ticketTypes, eq(ticketTypes.id, attendees.ticketTypeId))
    .where(whereClause);

  const rows = await database
    .select(attendeeQuerySelect())
    .from(attendees)
    .leftJoin(events, eq(events.id, attendees.eventId))
    .leftJoin(ticketTypes, eq(ticketTypes.id, attendees.ticketTypeId))
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as Array<AttendeeRecord & { eventTitle: string | null; ticketTypeName: string | null }>,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function createAttendeeRecord(
  database: AttendeeDatabase,
  input: CreateAttendeeDTO & {
    tenantId: string;
    createdByUserId: string;
    updatedByUserId: string;
    normalizedEmail: string;
    normalizedPhone: string;
    dateOfBirthValue: Date | null;
    checkedInAtValue: Date | null;
  }
) {
  const [attendee] = await database
    .insert(attendees)
    .values({
      tenantId: input.tenantId,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      bookingOrderId: input.bookingOrderId ?? null,
      fullName: input.fullName,
      email: input.normalizedEmail,
      phone: input.normalizedPhone,
      gender: input.gender ?? null,
      dateOfBirth: input.dateOfBirthValue,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      emergencyContactName: input.emergencyContactName ?? null,
      emergencyContactPhone: input.emergencyContactPhone ?? null,
      notes: input.notes ?? null,
      checkedInAt: input.checkedInAtValue,
      checkedInByUserId: input.checkedInByUserId ?? null,
      status: input.status,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.updatedByUserId
    })
    .returning(attendeeCoreSelect);

  return attendee ?? null;
}

export async function updateAttendeeRecord(
  database: AttendeeDatabase,
  tenantId: string,
  attendeeId: string,
  input: UpdateAttendeeDTO & {
    updatedByUserId: string;
    normalizedEmail?: string;
    normalizedPhone?: string;
    dateOfBirthValue?: Date | null;
    checkedInAtValue?: Date | null;
  }
) {
  const [attendee] = await database
    .update(attendees)
    .set({
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      ...(input.ticketTypeId === undefined ? {} : { ticketTypeId: input.ticketTypeId }),
      ...(input.bookingOrderId === undefined ? {} : { bookingOrderId: input.bookingOrderId }),
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
      ...(input.normalizedEmail === undefined ? {} : { email: input.normalizedEmail }),
      ...(input.normalizedPhone === undefined ? {} : { phone: input.normalizedPhone }),
      ...(input.gender === undefined ? {} : { gender: input.gender }),
      ...(input.dateOfBirthValue === undefined ? {} : { dateOfBirth: input.dateOfBirthValue }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.country === undefined ? {} : { country: input.country }),
      ...(input.emergencyContactName === undefined ? {} : { emergencyContactName: input.emergencyContactName }),
      ...(input.emergencyContactPhone === undefined ? {} : { emergencyContactPhone: input.emergencyContactPhone }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.checkedInAtValue === undefined ? {} : { checkedInAt: input.checkedInAtValue }),
      ...(input.checkedInByUserId === undefined ? {} : { checkedInByUserId: input.checkedInByUserId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date()
    })
    .where(and(eq(attendees.tenantId, tenantId), eq(attendees.id, attendeeId), optimisticLockCondition(attendees.updatedAt, input.lastKnownUpdatedAt), isNull(attendees.deletedAt)))
    .returning(attendeeCoreSelect);

  return attendee ?? null;
}

export async function softDeleteAttendeeRecord(
  database: AttendeeDatabase,
  tenantId: string,
  attendeeId: string,
  updatedByUserId: string,
  lastKnownUpdatedAt: string
) {
  const [attendee] = await database
    .update(attendees)
    .set({
      updatedByUserId,
      updatedAt: new Date(),
      deletedAt: new Date()
    })
    .where(and(eq(attendees.tenantId, tenantId), eq(attendees.id, attendeeId), optimisticLockCondition(attendees.updatedAt, lastKnownUpdatedAt), isNull(attendees.deletedAt)))
    .returning(attendeeCoreSelect);

  return attendee ?? null;
}

export async function markAttendeeCheckedInRecord(
  database: AttendeeDatabase,
  tenantId: string,
  attendeeId: string,
  input: { checkedInAt: Date; checkedInByUserId: string; updatedByUserId: string; lastKnownUpdatedAt: string }
) {
  const [attendee] = await database
    .update(attendees)
    .set({
      checkedInAt: input.checkedInAt,
      checkedInByUserId: input.checkedInByUserId,
      status: 'checked_in',
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date()
    })
    .where(and(eq(attendees.tenantId, tenantId), eq(attendees.id, attendeeId), optimisticLockCondition(attendees.updatedAt, input.lastKnownUpdatedAt), isNull(attendees.deletedAt)))
    .returning(attendeeCoreSelect);

  return attendee ?? null;
}

export async function revertAttendeeCheckInRecord(
  database: AttendeeDatabase,
  tenantId: string,
  attendeeId: string,
  updatedByUserId: string,
  lastKnownUpdatedAt: string
) {
  const [attendee] = await database
    .update(attendees)
    .set({
      checkedInAt: null,
      checkedInByUserId: null,
      status: 'confirmed',
      updatedByUserId,
      updatedAt: new Date()
    })
    .where(and(eq(attendees.tenantId, tenantId), eq(attendees.id, attendeeId), optimisticLockCondition(attendees.updatedAt, lastKnownUpdatedAt), isNull(attendees.deletedAt)))
    .returning(attendeeCoreSelect);

  return attendee ?? null;
}