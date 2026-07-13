import type { Context } from 'hono';

import { forbidden, badRequest } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  createGroupBooking,
  getGroupBooking,
  listGroupBookingsService,
  inviteMember,
  acceptInvitation,
  declineInvitation,
  removeMember,
  updateShares,
  recordContribution,
  cancelGroupBooking,
  getActivityLog,
  assignGroupBookingAttendees
} from './service.js';

import type {
  GroupBookingIdParamsInput,
  GroupBookingListQueryInput,
  InviteMemberInput,
  UpdateShareInput,
  RecordContributionInput,
  GroupBookingCancelInput,
  GroupBookingActivityQueryInput,
  GroupBookingAssignAttendeesInput
} from './validation.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const groupBookingsController = {
  async create(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const input = c.get('validatedBody') as any;
    const booking = await createGroupBooking(tenant.id, user.id, input);

    return successResponse(c, booking, 'Group booking created', 201);
  },

  async list(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const query = c.get('validatedQuery') as GroupBookingListQueryInput;
    const result = await listGroupBookingsService(tenant.id, user.id, query);

    return paginatedResponse(c, result.items, result.meta, 'Group bookings retrieved');
  },

  async get(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const booking = await getGroupBooking(tenant.id, id, user.id);

    return successResponse(c, booking, 'Group booking retrieved');
  },

  async invite(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const input = c.get('validatedBody') as InviteMemberInput;
    const member = await inviteMember(tenant.id, id, user.id, input);

    return successResponse(c, member, 'Member invited successfully', 201);
  },

  async acceptInvite(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const member = await acceptInvitation(tenant.id, id, user.id);

    return successResponse(c, member, 'Invitation accepted');
  },

  async declineInvite(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const member = await declineInvitation(tenant.id, id, user.id);

    return successResponse(c, member, 'Invitation declined');
  },

  async removeMember(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const query = c.req.query();
    const userIdToRemove = query.userId;
    const lastKnownUpdatedAt = query.lastKnownUpdatedAt;

    if (!userIdToRemove) {
      throw badRequest('userId query parameter is required');
    }

    const result = await removeMember(tenant.id, id, user.id, userIdToRemove, lastKnownUpdatedAt);
    return successResponse(c, result, 'Member removed successfully');
  },

  async updateShare(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const input = c.get('validatedBody') as UpdateShareInput;
    const result = await updateShares(tenant.id, id, user.id, input);

    return successResponse(c, result, 'Shares updated successfully');
  },

  async contribute(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const input = c.get('validatedBody') as RecordContributionInput;
    const member = await recordContribution(tenant.id, id, user.id, input);

    return successResponse(c, member, 'Contribution recorded successfully');
  },

  async cancel(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const input = c.get('validatedBody') as GroupBookingCancelInput;
    const booking = await cancelGroupBooking(tenant.id, id, user.id, input);

    return successResponse(c, booking, 'Group booking cancelled');
  },

  async getActivity(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const query = c.get('validatedQuery') as GroupBookingActivityQueryInput;
    const result = await getActivityLog(tenant.id, id, user.id, query);

    return paginatedResponse(c, result.items, result.meta, 'Activity logs retrieved');
  },

  async assignAttendees(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as GroupBookingIdParamsInput;
    const input = c.get('validatedBody') as GroupBookingAssignAttendeesInput;
    const result = await assignGroupBookingAttendees(tenant.id, id, user.id, input);

    return successResponse(c, result, 'Attendees assigned successfully');
  }
};
