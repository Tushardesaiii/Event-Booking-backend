import { db } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { canManageAttendees, canViewAttendees } from '../../policies/attendee.policy.js';
import { hasPermission } from '../../lib/permissions.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import {
  createAttendeeRecord,
  findActiveEventByTenantAndId,
  findActiveTicketTypeByTenantAndId,
  findAttendeeByTenantAndId,
  listAttendeesForTenant,
  markAttendeeCheckedInRecord,
  revertAttendeeCheckInRecord,
  softDeleteAttendeeRecord,
  updateAttendeeRecord
} from './repository.js';
import type { AttendeeDetailItem, AttendeeListItem, AttendeeListQuery, CreateAttendeeDTO, UpdateAttendeeDTO } from './types.js';

function assertAttendeeManagementAccess(membership: TenantMembershipRecord) {
  if (!canManageAttendees(membership.role)) {
    throw forbidden('Insufficient attendee permissions');
  }
}

function assertAttendeeCheckInAccess(membership: TenantMembershipRecord) {
  if (!canManageAttendees(membership.role) && !hasPermission(membership.role, 'ticket.checkin')) {
    throw forbidden('Insufficient attendee check-in permissions');
  }
}

function assertAttendeeReadAccess(membership: TenantMembershipRecord) {
  if (!canViewAttendees(membership.role)) {
    throw forbidden('Insufficient attendee permissions');
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.trim();
}

function resolveDateOfBirth(dateOfBirth?: string | null) {
  if (!dateOfBirth) {
    return null;
  }

  return new Date(`${dateOfBirth}T00:00:00.000Z`);
}

function resolveDateTime(value?: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value);
}

async function assertAttendeeReferencesBelongToTenant(tenantId: string, eventId: string, ticketTypeId: string) {
  const [event, ticketType] = await Promise.all([
    findActiveEventByTenantAndId(db, tenantId, eventId),
    findActiveTicketTypeByTenantAndId(db, tenantId, ticketTypeId)
  ]);

  if (!event) {
    throw badRequest('Invalid eventId for tenant');
  }

  if (!ticketType) {
    throw badRequest('Invalid ticketTypeId for tenant');
  }

  if (ticketType.eventId !== event.id) {
    throw badRequest('ticketTypeId must belong to the same event as eventId');
  }

  return { event, ticketType };
}

function normalizeAttendeeRow(row: Awaited<ReturnType<typeof findAttendeeByTenantAndId>>) {
  if (!row) {
    return null;
  }

  return row as AttendeeDetailItem;
}

export async function createAttendee(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  input: CreateAttendeeDTO
) {
  assertAttendeeManagementAccess(actorMembership);
  await assertAttendeeReferencesBelongToTenant(tenantId, input.eventId, input.ticketTypeId);

  if (input.status === 'checked_in' && (!input.checkedInAt || !input.checkedInByUserId)) {
    throw badRequest('checked_in attendees require checkedInAt and checkedInByUserId');
  }

  return db.transaction(async (tx) => {
    const attendee = await createAttendeeRecord(tx, {
      ...input,
      tenantId,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
      normalizedEmail: normalizeEmail(input.email),
      normalizedPhone: normalizePhone(input.phone),
      dateOfBirthValue: resolveDateOfBirth(input.dateOfBirth),
      checkedInAtValue: resolveDateTime(input.checkedInAt)
    });

    if (!attendee) {
      throw conflict('Unable to create attendee');
    }

    const created = await findAttendeeByTenantAndId(tx, tenantId, attendee.id);

    if (!created) {
      throw notFound('Attendee not found');
    }

    return normalizeAttendeeRow(created) as AttendeeDetailItem;
  });
}

export async function listAttendees(tenantId: string, actorMembership: TenantMembershipRecord, input: AttendeeListQuery) {
  assertAttendeeReadAccess(actorMembership);

  const pagination = parsePagination(input);
  const { rows, total } = await listAttendeesForTenant(db, tenantId, input, pagination);

  return {
    items: rows as AttendeeListItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getAttendeeById(tenantId: string, actorMembership: TenantMembershipRecord, attendeeId: string) {
  assertAttendeeReadAccess(actorMembership);

  const attendee = await findAttendeeByTenantAndId(db, tenantId, attendeeId);

  if (!attendee) {
    throw notFound('Attendee not found');
  }

  return normalizeAttendeeRow(attendee) as AttendeeDetailItem;
}

export async function updateAttendeeById(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  attendeeId: string,
  input: UpdateAttendeeDTO
) {
  assertAttendeeManagementAccess(actorMembership);

  const existing = await findAttendeeByTenantAndId(db, tenantId, attendeeId);

  if (!existing) {
    throw notFound('Attendee not found');
  }

  const nextEventId = input.eventId ?? existing.eventId;
  const nextTicketTypeId = input.ticketTypeId ?? existing.ticketTypeId;
  await assertAttendeeReferencesBelongToTenant(tenantId, nextEventId, nextTicketTypeId);

  if (input.status === 'checked_in' && (!input.checkedInAt || !input.checkedInByUserId)) {
    throw badRequest('checked_in attendees require checkedInAt and checkedInByUserId');
  }

  const updated = await db.transaction(async (tx) => {
    const row = await updateAttendeeRecord(tx, tenantId, attendeeId, {
      ...input,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      bookingOrderId: input.bookingOrderId,
      fullName: input.fullName,
      email: input.email ? normalizeEmail(input.email) : undefined,
      phone: input.phone ? normalizePhone(input.phone) : undefined,
      dateOfBirthValue: input.dateOfBirth === undefined ? undefined : resolveDateOfBirth(input.dateOfBirth),
      checkedInAtValue: input.checkedInAt === undefined ? undefined : resolveDateTime(input.checkedInAt),
      checkedInByUserId: input.checkedInByUserId,
      updatedByUserId: actorUserId,
      lastKnownUpdatedAt: input.lastKnownUpdatedAt
    });

    assertOptimisticUpdate(row);

    const loaded = await findAttendeeByTenantAndId(tx, tenantId, row.id);

    if (!loaded) {
      throw notFound('Attendee not found');
    }

    return loaded;
  });

  return normalizeAttendeeRow(updated) as AttendeeDetailItem;
}

export async function deleteAttendeeById(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  attendeeId: string,
  lastKnownUpdatedAt: string
) {
  assertAttendeeManagementAccess(actorMembership);

  return assertOptimisticUpdate(await softDeleteAttendeeRecord(db, tenantId, attendeeId, actorUserId, lastKnownUpdatedAt)) as AttendeeDetailItem;
}

export async function checkInAttendeeById(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  attendeeId: string,
  lastKnownUpdatedAt: string
) {
  assertAttendeeCheckInAccess(actorMembership);

  const existing = await findAttendeeByTenantAndId(db, tenantId, attendeeId);

  if (!existing) {
    throw notFound('Attendee not found');
  }

  if (existing.status === 'cancelled') {
    throw badRequest('Cancelled attendees cannot be checked in');
  }

  if (existing.checkedInAt) {
    throw conflict('Attendee is already checked in');
  }

  return db.transaction(async (tx) => {
    const row = await markAttendeeCheckedInRecord(tx, tenantId, attendeeId, {
      checkedInAt: new Date(),
      checkedInByUserId: actorUserId,
      updatedByUserId: actorUserId,
      lastKnownUpdatedAt
    });

    assertOptimisticUpdate(row);

    const loaded = await findAttendeeByTenantAndId(tx, tenantId, row.id);

    if (!loaded) {
      throw notFound('Attendee not found');
    }

    return normalizeAttendeeRow(loaded) as AttendeeDetailItem;
  });
}

export async function revertAttendeeCheckInById(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  attendeeId: string,
  lastKnownUpdatedAt: string
) {
  assertAttendeeCheckInAccess(actorMembership);

  const existing = await findAttendeeByTenantAndId(db, tenantId, attendeeId);

  if (!existing) {
    throw notFound('Attendee not found');
  }

  if (!existing.checkedInAt) {
    throw badRequest('Only checked-in attendees can be reverted');
  }

  return db.transaction(async (tx) => {
    const row = await revertAttendeeCheckInRecord(tx, tenantId, attendeeId, actorUserId, lastKnownUpdatedAt);

    assertOptimisticUpdate(row);

    const loaded = await findAttendeeByTenantAndId(tx, tenantId, row.id);

    if (!loaded) {
      throw notFound('Attendee not found');
    }

    return normalizeAttendeeRow(loaded) as AttendeeDetailItem;
  });
}