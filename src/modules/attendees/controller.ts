import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  checkInAttendeeById,
  createAttendee,
  deleteAttendeeById,
  getAttendeeById,
  listAttendees,
  revertAttendeeCheckInById,
  updateAttendeeById
} from './service.js';
import type { AttendeeIdParams, AttendeeListQuery, CreateAttendeeDTO, UpdateAttendeeDTO } from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const attendeesController = {
  async create(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreateAttendeeDTO;
    const attendee = await createAttendee(tenant.id, membership, user.id, input);

    return successResponse(c, attendee, 'Attendee created', 201);
  },

  async list(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const input = c.get('validatedQuery') as AttendeeListQuery;
    const result = await listAttendees(tenant.id, membership, input);

    return paginatedResponse(c, result.items, result.meta, 'Attendees retrieved');
  },

  async getById(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const { id } = c.get('validatedParams') as AttendeeIdParams;
    const attendee = await getAttendeeById(tenant.id, membership, id);

    return successResponse(c, attendee, 'Attendee retrieved');
  },

  async update(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as AttendeeIdParams;
    const input = c.get('validatedBody') as UpdateAttendeeDTO;
    const attendee = await updateAttendeeById(tenant.id, membership, user.id, id, input);

    return successResponse(c, attendee, 'Attendee updated');
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as AttendeeIdParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const attendee = await deleteAttendeeById(tenant.id, membership, user.id, id, lastKnownUpdatedAt);

    return successResponse(c, attendee, 'Attendee deleted');
  },

  async checkIn(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as AttendeeIdParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const attendee = await checkInAttendeeById(tenant.id, membership, user.id, id, lastKnownUpdatedAt);

    return successResponse(c, attendee, 'Attendee checked in');
  },

  async revertCheckIn(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as AttendeeIdParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const attendee = await revertAttendeeCheckInById(tenant.id, membership, user.id, id, lastKnownUpdatedAt);

    return successResponse(c, attendee, 'Attendee check-in reverted');
  }
};