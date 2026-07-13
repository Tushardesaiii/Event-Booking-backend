import type { Context } from 'hono';

import { forbidden, unauthorized } from '../../lib/errors.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  getEventSafetyProfile,
  getOrganizerSafetyProfile,
  reportSosIssue,
  triggerEmergencyAlert,
  listSosAlerts,
  updateSosAlertStatus
} from '../organizer-profiles/service.js';

function getTenantContext(c: Context<AppEnv>, allowGuest = false) {
  const tenant = c.get('tenant');
  const user = c.get('user');

  if (!tenant) {
    throw forbidden('Tenant context is required');
  }

  if (!user && !allowGuest) {
    throw unauthorized('User context is required');
  }

  return { tenant, user };
}

export const sosController = {
  async getEventSafety(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c, true);
    const eventSlug = c.req.param('eventSlug') as string;
    const safety = await getEventSafetyProfile(tenant.id, eventSlug);

    return successResponse(c, safety, 'Event safety details retrieved successfully');
  },

  async getOrganizerSafety(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c, true);
    const organizerSlug = c.req.param('organizerSlug') as string;
    const safety = await getOrganizerSafetyProfile(tenant.id, organizerSlug);

    return successResponse(c, safety, 'Organizer safety details retrieved successfully');
  },

  async reportIssue(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c, true);
    const input = c.get('validatedBody') as any;
    const alert = await reportSosIssue(tenant.id, user?.id ?? null, input);

    return successResponse(c, alert, 'Issue reported successfully', 201);
  },

  async triggerEmergency(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c, true);
    const input = c.get('validatedBody') as any;
    const result = await triggerEmergencyAlert(tenant.id, user?.id ?? null, input);

    return successResponse(c, result, 'Emergency alert triggered successfully', 201);
  },

  // Dashboard SOS console — list tenant alerts (optionally scoped by event/status).
  async listAlerts(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const eventId = c.req.query('eventId') || null;
    const status = c.req.query('status') || null;
    const alerts = await listSosAlerts(tenant.id, { eventId, status });

    return successResponse(c, alerts, 'SOS alerts retrieved successfully');
  },

  // Dashboard SOS console — advance an alert (acknowledge / resolve / cancel).
  async updateAlertStatus(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const id = c.req.param('id') as string;
    const { status } = c.get('validatedBody') as any;
    const updated = await updateSosAlertStatus(tenant.id, id, status);

    return successResponse(c, updated, 'SOS alert status updated successfully');
  }
};
