import { db } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { and, inArray, sql, isNull, eq } from 'drizzle-orm';
import { groupPlanMembers, groupPlans } from './schema.js';
import {
  createGroupPlanRecord,
  deactivateGroupPlanRecord,
  findGroupPlanById,
  findGroupPlanInviteById,
  listGroupPlansForTenant,
  addGroupPlanMember,
  findGroupPlanMember,
  removeGroupPlanMember,
  listGroupPlanMembers,
  createGroupPlanInvite,
  updateGroupPlanInviteStatus,
  createGroupPlanActivityRecord,
  listGroupPlanActivity,
  getGroupPlanMembersCount,
  updateGroupPlanRecord,
  removeAllGroupPlanMembers,
  groupPlanSelect
} from './repository.js';
import type {
  CreateGroupPlanDTO,
  UpdateGroupPlanDTO,
  GroupPlanListQuery,
  GroupPlanListItem,
  GroupPlanDetailItem
} from './types.js';
import { createInAppNotification } from '../notifications/service.js';

async function assertMember(groupPlanId: string, userId: string) {
  const member = await findGroupPlanMember(db, groupPlanId, userId);
  if (!member) {
    throw forbidden('You are not a member of this group plan');
  }
  return member;
}

async function assertAdminOrOwner(groupPlanId: string, userId: string) {
  const member = await assertMember(groupPlanId, userId);
  if (member.role !== 'owner' && member.role !== 'admin') {
    throw forbidden('Only admins or the owner can perform this action');
  }
  return member;
}

async function assertOwner(groupPlanId: string, userId: string) {
  const member = await assertMember(groupPlanId, userId);
  if (member.role !== 'owner') {
    throw forbidden('Only the owner can perform this action');
  }
  return member;
}

export async function createGroupPlan(
  tenantId: string,
  ownerUserId: string,
  input: CreateGroupPlanDTO
) {
  return db.transaction(async (tx) => {
    const plan = await createGroupPlanRecord(tx, {
      ...input,
      tenantId,
      ownerUserId
    });

    if (!plan) {
      throw conflict('Unable to create group plan');
    }

    // Auto-add creator as owner member
    await addGroupPlanMember(tx, plan.id, ownerUserId, 'owner');

    // Record activity
    await createGroupPlanActivityRecord(tx, plan.id, ownerUserId, 'group_created', {
      groupName: plan.name
    });

    return plan;
  });
}

export async function getGroupPlan(
  tenantId: string,
  id: string,
  userId: string
): Promise<GroupPlanDetailItem> {
  const plan = await findGroupPlanById(db, tenantId, id);
  if (!plan) {
    throw notFound('Group plan not found');
  }

  await assertMember(plan.id, userId);

  const members = await listGroupPlanMembers(db, plan.id);

  return {
    ...plan,
    members
  };
}

export async function updateGroupPlan(
  tenantId: string,
  id: string,
  actorUserId: string,
  input: UpdateGroupPlanDTO
) {
  return db.transaction(async (tx) => {
    const original = await findGroupPlanById(tx, tenantId, id);
    if (!original) {
      throw notFound('Group plan not found');
    }

    await assertAdminOrOwner(original.id, actorUserId);

    const updated = await updateGroupPlanRecord(tx, tenantId, id, {
      ...input,
      updatedByUserId: actorUserId
    });

    assertOptimisticUpdate(updated);

    await createGroupPlanActivityRecord(tx, id, actorUserId, 'group_updated', {
      fields: Object.keys(input).filter((k) => k !== 'lastKnownUpdatedAt')
    });

    return updated!;
  });
}

export async function deleteGroupPlan(
  tenantId: string,
  id: string,
  actorUserId: string,
  lastKnownUpdatedAt: string
) {
  return db.transaction(async (tx) => {
    const original = await findGroupPlanById(tx, tenantId, id);
    if (!original) {
      throw notFound('Group plan not found');
    }

    await assertOwner(original.id, actorUserId);

    const deleted = await deactivateGroupPlanRecord(tx, tenantId, id, actorUserId, lastKnownUpdatedAt);
    assertOptimisticUpdate(deleted);

    // Remove all members
    await removeAllGroupPlanMembers(tx, id);

    await createGroupPlanActivityRecord(tx, id, actorUserId, 'group_deleted', {});

    return deleted;
  });
}

export async function listGroupPlans(
  tenantId: string,
  userId: string,
  input: GroupPlanListQuery
) {
  const pagination = parsePagination(input);
  const { rows, total } = await listGroupPlansForTenant(db, tenantId, userId, input, pagination);

  const planIds = rows.map((r) => r.id);
  const counts = planIds.length > 0 ? await db
    .select({
      groupPlanId: groupPlanMembers.groupPlanId,
      count: sql<number>`count(*)::int`
    })
    .from(groupPlanMembers)
    .where(and(inArray(groupPlanMembers.groupPlanId, planIds), isNull(groupPlanMembers.deletedAt)))
    .groupBy(groupPlanMembers.groupPlanId) : [];

  const countsMap = new Map(counts.map((c) => [c.groupPlanId, c.count]));

  const items = rows.map((row) => ({
    ...row,
    membersCount: countsMap.get(row.id) || 0
  }));

  return {
    items,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function inviteUserToGroup(
  tenantId: string,
  groupPlanId: string,
  invitedByUserId: string,
  inviteeUserId: string
) {
  const plan = await findGroupPlanById(db, tenantId, groupPlanId);
  if (!plan) {
    throw notFound('Group plan not found');
  }

  await assertMember(plan.id, invitedByUserId);

  const existingMember = await findGroupPlanMember(db, plan.id, inviteeUserId);
  if (existingMember) {
    throw badRequest('User is already a member of this group plan');
  }

  const invite = await createGroupPlanInvite(db, plan.id, invitedByUserId, inviteeUserId);
  if (!invite) {
    throw conflict('Unable to create group invite');
  }

  await createGroupPlanActivityRecord(db, plan.id, invitedByUserId, 'invite_sent', {
    inviteeUserId
  });

  // Auto-generate notification: invited to group
  await createInAppNotification({
    tenantId,
    userId: inviteeUserId,
    title: 'New Group Invitation',
    message: `You have been invited to join the group "${plan.name}"`,
    type: 'invited_to_group',
    entityType: 'group_plan',
    entityId: plan.id,
    metadata: { inviteId: invite.id, groupName: plan.name }
  });

  return invite;
}

export async function acceptGroupInvite(
  tenantId: string,
  inviteId: string,
  userId: string
) {
  return db.transaction(async (tx) => {
    const invite = await findGroupPlanInviteById(tx, inviteId);
    if (!invite || invite.status !== 'pending' || invite.inviteeUserId !== userId) {
      throw notFound('Group invitation not found or already processed');
    }

    const plan = await findGroupPlanById(tx, tenantId, invite.groupPlanId);
    if (!plan) {
      throw notFound('Group plan not found');
    }

    // Update invite status
    const updatedInvite = await updateGroupPlanInviteStatus(tx, inviteId, 'accepted');

    // Add to members list
    await addGroupPlanMember(tx, invite.groupPlanId, userId, 'member');

    await createGroupPlanActivityRecord(tx, invite.groupPlanId, userId, 'invite_accepted', {});

    // Notify inviter
    await createInAppNotification({
      tenantId,
      userId: invite.invitedByUserId,
      title: 'Invitation Accepted',
      message: `Your invitation to join "${plan.name}" was accepted`,
      type: 'invite_accepted',
      entityType: 'group_plan',
      entityId: plan.id,
      metadata: { inviteId: invite.id, inviteeUserId: userId, groupName: plan.name }
    });

    return updatedInvite;
  });
}

export async function rejectGroupInvite(
  tenantId: string,
  inviteId: string,
  userId: string
) {
  const invite = await findGroupPlanInviteById(db, inviteId);
  if (!invite || invite.status !== 'pending' || invite.inviteeUserId !== userId) {
    throw notFound('Group invitation not found or already processed');
  }

  const updatedInvite = await updateGroupPlanInviteStatus(db, inviteId, 'rejected');

  await createGroupPlanActivityRecord(db, invite.groupPlanId, userId, 'invite_rejected', {});

  return updatedInvite;
}

export async function leaveGroupPlan(
  tenantId: string,
  id: string,
  userId: string
) {
  return db.transaction(async (tx) => {
    const plan = await findGroupPlanById(tx, tenantId, id);
    if (!plan) {
      throw notFound('Group plan not found');
    }

    const member = await assertMember(plan.id, userId);

    if (member.role === 'owner') {
      throw badRequest('Owners cannot leave without transferring ownership first');
    }

    await removeGroupPlanMember(tx, plan.id, userId);

    await createGroupPlanActivityRecord(tx, plan.id, userId, 'member_left', {});

    return { success: true };
  });
}

export async function removeMemberFromGroup(
  tenantId: string,
  id: string,
  actorUserId: string,
  userIdToRemove: string
) {
  return db.transaction(async (tx) => {
    const plan = await findGroupPlanById(tx, tenantId, id);
    if (!plan) {
      throw notFound('Group plan not found');
    }

    await assertAdminOrOwner(plan.id, actorUserId);

    const memberToRemove = await findGroupPlanMember(tx, plan.id, userIdToRemove);
    if (!memberToRemove) {
      throw notFound('Member to remove not found');
    }

    if (memberToRemove.role === 'owner') {
      throw forbidden('Cannot remove the owner of the group plan');
    }

    await removeGroupPlanMember(tx, plan.id, userIdToRemove);

    await createGroupPlanActivityRecord(tx, plan.id, actorUserId, 'member_removed', {
      removedUserId: userIdToRemove
    });

    return { success: true };
  });
}

export async function transferGroupOwnership(
  tenantId: string,
  id: string,
  actorUserId: string,
  newOwnerUserId: string
) {
  return db.transaction(async (tx) => {
    const plan = await findGroupPlanById(tx, tenantId, id);
    if (!plan) {
      throw notFound('Group plan not found');
    }

    await assertOwner(plan.id, actorUserId);

    const newOwnerMember = await findGroupPlanMember(tx, plan.id, newOwnerUserId);
    if (!newOwnerMember) {
      throw badRequest('New owner must be a member of the group');
    }

    // Update group plan record owner
    const updatedPlan = await tx
      .update(groupPlans)
      .set({
        ownerUserId: newOwnerUserId,
        updatedAt: new Date()
      })
      .where(eq(groupPlans.id, id))
      .returning(groupPlanSelect);

    // Demote current owner to member and promote new owner
    await tx.update(groupPlanMembers).set({ role: 'member' }).where(eq(groupPlanMembers.id, (await findGroupPlanMember(tx, id, actorUserId))!.id));
    await tx.update(groupPlanMembers).set({ role: 'owner' }).where(eq(groupPlanMembers.id, newOwnerMember.id));

    await createGroupPlanActivityRecord(tx, plan.id, actorUserId, 'ownership_transferred', {
      newOwnerUserId
    });

    return updatedPlan[0];
  });
}

export async function getMembers(
  tenantId: string,
  id: string,
  userId: string
) {
  const plan = await findGroupPlanById(db, tenantId, id);
  if (!plan) {
    throw notFound('Group plan not found');
  }

  await assertMember(plan.id, userId);

  return listGroupPlanMembers(db, plan.id);
}

export async function getActivity(
  tenantId: string,
  id: string,
  userId: string,
  query: { page?: number; limit?: number }
) {
  const plan = await findGroupPlanById(db, tenantId, id);
  if (!plan) {
    throw notFound('Group plan not found');
  }

  await assertMember(plan.id, userId);

  const pagination = parsePagination(query);
  const { rows, total } = await listGroupPlanActivity(db, plan.id, pagination);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}
