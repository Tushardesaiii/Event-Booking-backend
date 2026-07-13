import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { groupBookings, groupBookingMembers, groupBookingActivity } from './schema.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';

type DBInstance = typeof db | any;

export async function findGroupBookingById(database: DBInstance, tenantId: string, id: string) {
  const [booking] = await database
    .select()
    .from(groupBookings)
    .where(and(eq(groupBookings.tenantId, tenantId), eq(groupBookings.id, id), isNull(groupBookings.deletedAt)))
    .limit(1);
  return booking ?? null;
}

export async function createGroupBookingRecord(
  database: DBInstance,
  input: {
    tenantId: string;
    eventId: string;
    bookingOrderId: string;
    createdByUserId: string;
    title: string;
    status: string;
    totalAmount: string;
    collectedAmount: string;
    expiresAt: Date | null;
  }
) {
  const [booking] = await database
    .insert(groupBookings)
    .values(input)
    .returning();
  return booking ?? null;
}

export async function updateGroupBookingRecord(
  database: DBInstance,
  tenantId: string,
  id: string,
  input: {
    title?: string;
    status?: string;
    collectedAmount?: string;
    expiresAt?: Date | null;
    lastKnownUpdatedAt: string;
  }
) {
  const [booking] = await database
    .update(groupBookings)
    .set({
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.collectedAmount === undefined ? {} : { collectedAmount: input.collectedAmount }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      version: sql`${groupBookings.version} + 1`,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(groupBookings.tenantId, tenantId),
        eq(groupBookings.id, id),
        optimisticLockCondition(groupBookings.updatedAt, input.lastKnownUpdatedAt),
        isNull(groupBookings.deletedAt)
      )
    )
    .returning();
  return booking ?? null;
}

export async function listGroupBookings(
  database: DBInstance,
  tenantId: string,
  filters: { userId?: string; status?: string; eventId?: string },
  pagination: { offset: number; limit: number }
) {
  const conditions = [
    eq(groupBookings.tenantId, tenantId),
    isNull(groupBookings.deletedAt)
  ];

  if (filters.status) {
    conditions.push(eq(groupBookings.status, filters.status));
  }

  if (filters.eventId) {
    conditions.push(eq(groupBookings.eventId, filters.eventId));
  }

  if (filters.userId) {
    const subquery = database
      .select({ groupBookingId: groupBookingMembers.groupBookingId })
      .from(groupBookingMembers)
      .where(and(eq(groupBookingMembers.userId, filters.userId), isNull(groupBookingMembers.deletedAt)));
    conditions.push(sql`${groupBookings.id} in (${subquery})`);
  }

  const rows = await database
    .select()
    .from(groupBookings)
    .where(and(...conditions))
    .orderBy(desc(groupBookings.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  const [countResult] = await database
    .select({ count: sql<number>`count(*)` })
    .from(groupBookings)
    .where(and(...conditions));

  return {
    rows,
    total: Number(countResult?.count || 0)
  };
}

export async function findGroupBookingMember(database: DBInstance, groupBookingId: string, userId: string) {
  const [member] = await database
    .select()
    .from(groupBookingMembers)
    .where(
      and(
        eq(groupBookingMembers.groupBookingId, groupBookingId),
        eq(groupBookingMembers.userId, userId),
        isNull(groupBookingMembers.deletedAt)
      )
    )
    .limit(1);
  return member ?? null;
}

export async function findGroupBookingMemberById(database: DBInstance, memberId: string) {
  const [member] = await database
    .select()
    .from(groupBookingMembers)
    .where(and(eq(groupBookingMembers.id, memberId), isNull(groupBookingMembers.deletedAt)))
    .limit(1);
  return member ?? null;
}

export async function addGroupBookingMember(
  database: DBInstance,
  input: {
    groupBookingId: string;
    userId: string;
    role: string;
    inviteStatus: string;
    contributionAmount: string;
    paidAmount: string;
    joinedAt?: Date | null;
  }
) {
  const [member] = await database
    .insert(groupBookingMembers)
    .values(input)
    .returning();
  return member ?? null;
}

export async function updateGroupBookingMemberRecord(
  database: DBInstance,
  id: string,
  input: {
    inviteStatus?: string;
    contributionAmount?: string;
    paidAmount?: string;
    joinedAt?: Date | null;
    lastKnownUpdatedAt?: string;
  }
) {
  const updateConditions = [
    eq(groupBookingMembers.id, id),
    isNull(groupBookingMembers.deletedAt)
  ];
  if (input.lastKnownUpdatedAt) {
    updateConditions.push(optimisticLockCondition(groupBookingMembers.updatedAt, input.lastKnownUpdatedAt));
  }
  const [member] = await database
    .update(groupBookingMembers)
    .set({
      ...(input.inviteStatus === undefined ? {} : { inviteStatus: input.inviteStatus }),
      ...(input.contributionAmount === undefined ? {} : { contributionAmount: input.contributionAmount }),
      ...(input.paidAmount === undefined ? {} : { paidAmount: input.paidAmount }),
      ...(input.joinedAt === undefined ? {} : { joinedAt: input.joinedAt }),
      version: sql`${groupBookingMembers.version} + 1`,
      updatedAt: new Date()
    })
    .where(and(...updateConditions))
    .returning();
  return member ?? null;
}

export async function removeGroupBookingMember(database: DBInstance, groupBookingId: string, userId: string) {
  const [member] = await database
    .update(groupBookingMembers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(groupBookingMembers.groupBookingId, groupBookingId),
        eq(groupBookingMembers.userId, userId),
        isNull(groupBookingMembers.deletedAt)
      )
    )
    .returning();
  return member ?? null;
}

export async function listGroupBookingMembers(database: DBInstance, groupBookingId: string) {
  return database
    .select()
    .from(groupBookingMembers)
    .where(and(eq(groupBookingMembers.groupBookingId, groupBookingId), isNull(groupBookingMembers.deletedAt)))
    .orderBy(asc(groupBookingMembers.createdAt));
}

export async function getGroupBookingMembersCount(database: DBInstance, groupBookingId: string) {
  const [countResult] = await database
    .select({ count: sql<number>`count(*)` })
    .from(groupBookingMembers)
    .where(
      and(
        eq(groupBookingMembers.groupBookingId, groupBookingId),
        eq(groupBookingMembers.inviteStatus, 'accepted'),
        isNull(groupBookingMembers.deletedAt)
      )
    );
  return Number(countResult?.count || 0);
}

export async function createGroupBookingActivityRecord(
  database: DBInstance,
  groupBookingId: string,
  actorUserId: string | null,
  type: string,
  metadata: Record<string, any> = {}
) {
  const [activity] = await database
    .insert(groupBookingActivity)
    .values({
      groupBookingId,
      actorUserId,
      type,
      metadata
    })
    .returning();
  return activity ?? null;
}

export async function listGroupBookingActivity(
  database: DBInstance,
  groupBookingId: string,
  pagination: { offset: number; limit: number }
) {
  const conditions = [
    eq(groupBookingActivity.groupBookingId, groupBookingId)
  ];

  const rows = await database
    .select()
    .from(groupBookingActivity)
    .where(and(...conditions))
    .orderBy(desc(groupBookingActivity.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  const [countResult] = await database
    .select({ count: sql<number>`count(*)` })
    .from(groupBookingActivity)
    .where(and(...conditions));

  return {
    rows,
    total: Number(countResult?.count || 0)
  };
}
