import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  acceptGroupInvite,
  createGroupPlan,
  deleteGroupPlan,
  getActivity,
  getGroupPlan,
  getMembers,
  inviteUserToGroup,
  leaveGroupPlan,
  rejectGroupInvite,
  removeMemberFromGroup,
  transferGroupOwnership,
  updateGroupPlan,
  listGroupPlans
} from './service.js';
import type {
  CreateGroupPlanDTO,
  UpdateGroupPlanDTO,
  InviteMemberDTO,
  GroupPlanListQuery,
  GroupPlanIdParams,
  GroupPlanInviteParams
} from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const groupPlansController = {
  async create(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreateGroupPlanDTO;
    const plan = await createGroupPlan(tenant.id, user.id, input);

    return successResponse(c, plan, 'Group plan created', 201);
  },

  async list(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const query = c.get('validatedQuery') as GroupPlanListQuery;
    const result = await listGroupPlans(tenant.id, user.id, query);

    return paginatedResponse(c, result.items, result.meta, 'Group plans retrieved');
  },

  async get(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const plan = await getGroupPlan(tenant.id, id, user.id);

    return successResponse(c, plan, 'Group plan retrieved');
  },

  async update(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const input = c.get('validatedBody') as UpdateGroupPlanDTO;
    const plan = await updateGroupPlan(tenant.id, id, user.id, input);

    return successResponse(c, plan, 'Group plan updated');
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const plan = await deleteGroupPlan(tenant.id, id, user.id, lastKnownUpdatedAt);

    return successResponse(c, plan, 'Group plan deleted/archived');
  },

  async invite(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const { inviteeUserId } = c.get('validatedBody') as InviteMemberDTO;
    const invite = await inviteUserToGroup(tenant.id, id, user.id, inviteeUserId);

    return successResponse(c, invite, 'Invitation sent successfully', 201);
  },

  async acceptInvite(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { inviteId } = c.get('validatedParams') as GroupPlanInviteParams;
    const invite = await acceptGroupInvite(tenant.id, inviteId, user.id);

    return successResponse(c, invite, 'Invitation accepted');
  },

  async rejectInvite(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { inviteId } = c.get('validatedParams') as GroupPlanInviteParams;
    const invite = await rejectGroupInvite(tenant.id, inviteId, user.id);

    return successResponse(c, invite, 'Invitation rejected');
  },

  async leave(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const result = await leaveGroupPlan(tenant.id, id, user.id);

    return successResponse(c, result, 'Successfully left the group plan');
  },

  async removeMember(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const query = c.req.query();
    const userIdToRemove = query.userId;

    if (!userIdToRemove) {
      throw forbidden('userId query parameter is required');
    }

    const result = await removeMemberFromGroup(tenant.id, id, user.id, userIdToRemove);
    return successResponse(c, result, 'Member removed successfully');
  },

  async transferOwnership(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const { newOwnerUserId } = c.get('validatedBody') as { newOwnerUserId: string };

    if (!newOwnerUserId) {
      throw forbidden('newOwnerUserId is required in body');
    }

    const plan = await transferGroupOwnership(tenant.id, id, user.id, newOwnerUserId);
    return successResponse(c, plan, 'Group ownership transferred successfully');
  },

  async getMembers(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const members = await getMembers(tenant.id, id, user.id);

    return successResponse(c, members, 'Group members retrieved');
  },

  async getActivity(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupPlanIdParams;
    const query = c.req.query();
    const result = await getActivity(tenant.id, id, user.id, {
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined
    });

    return paginatedResponse(c, result.items, result.meta, 'Group activity retrieved');
  }
};
