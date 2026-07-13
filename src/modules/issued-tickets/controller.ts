import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  checkInIssuedTicketByTicketNumber,
  deleteIssuedTicketByTicketNumber,
  getIssuedTicketByTicketNumber,
  listIssuedTickets,
  updateIssuedTicketByTicketNumber,
  validateIssuedTicket
} from './service.js';
import type {
  CheckInIssuedTicketDTO,
  IssuedTicketListQuery,
  IssuedTicketNumberParams,
  IssuedTicketValidateDTO,
  UpdateIssuedTicketDTO
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

export const issuedTicketsController = {
  async list(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const input = c.get('validatedQuery') as IssuedTicketListQuery;
    const result = await listIssuedTickets(tenant.id, membership, input);
    return paginatedResponse(c, result.items, result.meta, 'Issued tickets retrieved');
  },

  async getByTicketNumber(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { ticketNumber } = c.get('validatedParams') as IssuedTicketNumberParams;
    const ticket = await getIssuedTicketByTicketNumber(tenant.id, membership, user.id, ticketNumber);
    return successResponse(c, ticket, 'Issued ticket retrieved');
  },

  async update(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { ticketNumber } = c.get('validatedParams') as IssuedTicketNumberParams;
    const input = c.get('validatedBody') as UpdateIssuedTicketDTO;
    const ticket = await updateIssuedTicketByTicketNumber(tenant.id, membership, user.id, ticketNumber, input);
    return successResponse(c, ticket, 'Issued ticket updated');
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const { ticketNumber } = c.get('validatedParams') as IssuedTicketNumberParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const ticket = await deleteIssuedTicketByTicketNumber(tenant.id, membership, ticketNumber, lastKnownUpdatedAt);
    return successResponse(c, ticket, 'Issued ticket deleted');
  },

  async validate(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const input = c.get('validatedBody') as IssuedTicketValidateDTO;
    const result = await validateIssuedTicket(tenant.id, membership, user.id, input);
    return successResponse(c, result, 'Issued ticket validated');
  },

  async checkIn(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { ticketNumber } = c.get('validatedParams') as IssuedTicketNumberParams;
    const input = c.get('validatedBody') as CheckInIssuedTicketDTO;
    const ticket = await checkInIssuedTicketByTicketNumber(tenant.id, membership, user.id, ticketNumber, input);
    return successResponse(c, ticket, 'Issued ticket checked in');
  }
};
