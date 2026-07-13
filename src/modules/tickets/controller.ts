import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  createTicketType,
  deleteTicketTypeBySlug,
  getTicketTypeBySlug,
  listTicketTypes,
  updateTicketTypeBySlug
} from './service.js';
import type { CreateTicketTypeDTO, TicketTypeListQuery, TicketTypeSlugParams, UpdateTicketTypeDTO } from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const ticketsController = {
  async create(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreateTicketTypeDTO;
    const ticketType = await createTicketType(tenant.id, membership, user.id, input);

    return successResponse(c, ticketType, 'Ticket type created', 201);
  },

  async list(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const input = c.get('validatedQuery') as TicketTypeListQuery;
    const result = await listTicketTypes(tenant.id, membership, input);

    return paginatedResponse(c, result.items, result.meta, 'Ticket types retrieved');
  },

  async getBySlug(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TicketTypeSlugParams;
    const ticketType = await getTicketTypeBySlug(tenant.id, membership, slug);

    return successResponse(c, ticketType, 'Ticket type retrieved');
  },

  async update(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TicketTypeSlugParams;
    const input = c.get('validatedBody') as UpdateTicketTypeDTO;
    const ticketType = await updateTicketTypeBySlug(tenant.id, membership, user.id, slug, input);

    return successResponse(c, ticketType, 'Ticket type updated');
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { slug } = c.get('validatedParams') as TicketTypeSlugParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const ticketType = await deleteTicketTypeBySlug(tenant.id, membership, user.id, slug, lastKnownUpdatedAt);

    return successResponse(c, ticketType, 'Ticket type deleted');
  }
};
