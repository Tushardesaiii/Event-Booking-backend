import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { groupPlans, groupPlanMembers, groupPlanInvites, groupPlanActivity } from './schema.js';
import { users } from '../../db/schema/users.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type {
  CreateGroupPlanDTO,
  UpdateGroupPlanDTO,
  GroupPlanRecord,
  GroupPlanMemberRecord,
  GroupPlanInviteRecord,
  GroupPlanActivityRecord,
  GroupPlanListQuery
} from './types.js';

type DBInstance = typeof db | any;

export const groupPlanSelect = {
  id: groupPlans.id,
  tenantId: groupPlans.tenantId,
  name: groupPlans.name,
  description: groupPlans.description,
  eventId: groupPlans.eventId,
  ownerUserId: groupPlans.ownerUserId,
  isActive: groupPlans.isActive,
  isArchived: groupPlans.isArchived,
  createdByUserId: groupPlans.createdByUserId,
  updatedByUserId: groupPlans.updatedByUserId,
  createdAt: groupPlans.createdAt,
  updatedAt: groupPlans.updatedAt,
  deletedAt: groupPlans.deletedAt
} as const;

export async function findGroupPlanById(
  database: DBInstance,
  tenantId: string,
  id: string
) {
  const [plan] = await database
    .select(groupPlanSelect)
    .from(groupPlans)
    .where(and(eq(groupPlans.tenantId, tenantId), eq(groupPlans.id, id), isNull(groupPlans.deletedAt)))
    .limit(1);

  return plan ?? null;
}

export async function findGroupPlanInviteById(
  database: DBInstance,
  inviteId: string
) {
  const [invite] = await database
    .select()
    .from(groupPlanInvites)
    .where(eq(groupPlanInvites.id, inviteId))
    .limit(1);

  return invite ?? null;
}

export async function createGroupPlanRecord(
  database: DBInstance,
  input: CreateGroupPlanDTO & { tenantId: string; ownerUserId: string }
) {
  const [plan] = await database
    .insert(groupPlans)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      description: input.description ?? null,
      eventId: input.eventId ?? null,
      ownerUserId: input.ownerUserId,
      isActive: true,
      isArchived: false,
      createdByUserId: input.ownerUserId,
      updatedByUserId: input.ownerUserId
    })
    .returning(groupPlanSelect);

  return plan ?? null;
}

export async function updateGroupPlanRecord(
  database: DBInstance,
  tenantId: string,
  id: string,
  input: UpdateGroupPlanDTO & { updatedByUserId: string }
) {
  const [plan] = await database
    .update(groupPlans)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description ?? null }),
      ...(input.eventId === undefined ? {} : { eventId: input.eventId ?? null }),
      ...(input.isArchived === undefined ? {} : { isArchived: input.isArchived }),
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(groupPlans.tenantId, tenantId),
        eq(groupPlans.id, id),
        optimisticLockCondition(groupPlans.updatedAt, input.lastKnownUpdatedAt),
        isNull(groupPlans.deletedAt)
      )
    )
    .returning(groupPlanSelect);

  return plan ?? null;
}

export async function deactivateGroupPlanRecord(
  database: DBInstance,
  tenantId: string,
  id: string,
  updatedByUserId: string,
  lastKnownUpdatedAt: string
) {
  const [plan] = await database
    .update(groupPlans)
    .set({
      isArchived: true,
      updatedByUserId,
      updatedAt: new Date(),
      deletedAt: new Date()
    })
    .where(
      and(
        eq(groupPlans.tenantId, tenantId),
        eq(groupPlans.id, id),
        optimisticLockCondition(groupPlans.updatedAt, lastKnownUpdatedAt),
        isNull(groupPlans.deletedAt)
      )
    )
    .returning(groupPlanSelect);

  return plan ?? null;
}

export async function listGroupPlansForTenant(
  database: DBInstance,
  tenantId: string,
  userId: string,
  input: GroupPlanListQuery,
  pagination: { offset: number; limit: number }
) {
  // Select group plans where the user is a member
  const conditions = [
    eq(groupPlans.tenantId, tenantId),
    isNull(groupPlans.deletedAt),
    eq(groupPlanMembers.userId, userId),
    isNull(groupPlanMembers.deletedAt)
  ];

  if (input.search) {
    const searchPattern = `%${input.search}%`;
    conditions.push(or(ilike(groupPlans.name, searchPattern), ilike(groupPlans.description, searchPattern))!);
  }

  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(distinct ${groupPlans.id})` })
    .from(groupPlans)
    .innerJoin(groupPlanMembers, eq(groupPlans.id, groupPlanMembers.groupPlanId))
    .where(whereClause);

  const rows = await database
    .select({
      id: groupPlans.id,
      tenantId: groupPlans.tenantId,
      name: groupPlans.name,
      description: groupPlans.description,
      eventId: groupPlans.eventId,
      ownerUserId: groupPlans.ownerUserId,
      isActive: groupPlans.isActive,
      isArchived: groupPlans.isArchived,
      createdByUserId: groupPlans.createdByUserId,
      updatedByUserId: groupPlans.updatedByUserId,
      createdAt: groupPlans.createdAt,
      updatedAt: groupPlans.updatedAt
    })
    .from(groupPlans)
    .innerJoin(groupPlanMembers, eq(groupPlans.id, groupPlanMembers.groupPlanId))
    .where(whereClause)
    .orderBy(desc(groupPlans.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as GroupPlanRecord[],
    total: Number(totalRow?.total ?? 0)
  };
}

export async function addGroupPlanMember(
  database: DBInstance,
  groupPlanId: string,
  userId: string,
  role: string
) {
  const [member] = await database
    .insert(groupPlanMembers)
    .values({
      groupPlanId,
      userId,
      role,
      joinedAt: new Date()
    })
    .returning();

  return member ?? null;
}

export async function removeGroupPlanMember(
  database: DBInstance,
  groupPlanId: string,
  userId: string
) {
  const [member] = await database
    .update(groupPlanMembers)
    .set({
      deletedAt: new Date()
    })
    .where(and(eq(groupPlanMembers.groupPlanId, groupPlanId), eq(groupPlanMembers.userId, userId), isNull(groupPlanMembers.deletedAt)))
    .returning();

  return member ?? null;
}

export async function removeAllGroupPlanMembers(
  database: DBInstance,
  groupPlanId: string
) {
  return database
    .update(groupPlanMembers)
    .set({
      deletedAt: new Date()
    })
    .where(and(eq(groupPlanMembers.groupPlanId, groupPlanId), isNull(groupPlanMembers.deletedAt)))
    .returning();
}

export async function findGroupPlanMember(
  database: DBInstance,
  groupPlanId: string,
  userId: string
) {
  const [member] = await database
    .select()
    .from(groupPlanMembers)
    .where(and(eq(groupPlanMembers.groupPlanId, groupPlanId), eq(groupPlanMembers.userId, userId), isNull(groupPlanMembers.deletedAt)))
    .limit(1);

  return member ?? null;
}

export async function listGroupPlanMembers(
  database: DBInstance,
  groupPlanId: string
) {
  return database
    .select({
      id: groupPlanMembers.id,
      groupPlanId: groupPlanMembers.groupPlanId,
      userId: groupPlanMembers.userId,
      role: groupPlanMembers.role,
      joinedAt: groupPlanMembers.joinedAt,
      username: users.username,
      fullName: users.fullName,
      avatarAssetId: users.avatarAssetId
    })
    .from(groupPlanMembers)
    .innerJoin(users, eq(groupPlanMembers.userId, users.id))
    .where(and(eq(groupPlanMembers.groupPlanId, groupPlanId), isNull(groupPlanMembers.deletedAt)))
    .orderBy(asc(groupPlanMembers.joinedAt));
}

export async function createGroupPlanInvite(
  database: DBInstance,
  groupPlanId: string,
  invitedByUserId: string,
  inviteeUserId: string
) {
  const [invite] = await database
    .insert(groupPlanInvites)
    .values({
      groupPlanId,
      invitedByUserId,
      inviteeUserId,
      status: 'pending'
    })
    .returning();

  return invite ?? null;
}

export async function updateGroupPlanInviteStatus(
  database: DBInstance,
  inviteId: string,
  status: 'accepted' | 'rejected'
) {
  const [invite] = await database
    .update(groupPlanInvites)
    .set({
      status,
      updatedAt: new Date()
    })
    .where(eq(groupPlanInvites.id, inviteId))
    .returning();

  return invite ?? null;
}

export async function createGroupPlanActivityRecord(
  database: DBInstance,
  groupPlanId: string,
  userId: string | null,
  activityType: string,
  details: Record<string, any>
) {
  const [activity] = await database
    .insert(groupPlanActivity)
    .values({
      groupPlanId,
      userId,
      activityType,
      details
    })
    .returning();

  return activity ?? null;
}

export async function listGroupPlanActivity(
  database: DBInstance,
  groupPlanId: string,
  pagination: { offset: number; limit: number }
) {
  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(groupPlanActivity)
    .where(eq(groupPlanActivity.groupPlanId, groupPlanId));

  const rows = await database
    .select({
      id: groupPlanActivity.id,
      groupPlanId: groupPlanActivity.groupPlanId,
      userId: groupPlanActivity.userId,
      activityType: groupPlanActivity.activityType,
      details: groupPlanActivity.details,
      createdAt: groupPlanActivity.createdAt,
      username: users.username,
      fullName: users.fullName
    })
    .from(groupPlanActivity)
    .leftJoin(users, eq(groupPlanActivity.userId, users.id))
    .where(eq(groupPlanActivity.groupPlanId, groupPlanId))
    .orderBy(desc(groupPlanActivity.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function getGroupPlanMembersCount(
  database: DBInstance,
  groupPlanId: string
) {
  const [row] = await database
    .select({ count: sql<number>`count(*)` })
    .from(groupPlanMembers)
    .where(and(eq(groupPlanMembers.groupPlanId, groupPlanId), isNull(groupPlanMembers.deletedAt)));

  return Number(row?.count ?? 0);
}
