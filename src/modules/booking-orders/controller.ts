import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  assignBookingOrderAttendees,
  createBookingOrder,
  deleteBookingOrderByOrderNumber,
  getBookingOrderByOrderNumber,
  listBookingOrderAttendees,
  listBookingOrderItems,
  listBookingOrders,
  updateBookingOrderByOrderNumber
} from './service.js';
import type {
  AssignBookingOrderAttendeesDTO,
  BookingOrderAttendeesQuery,
  BookingOrderListQuery,
  BookingOrderNumberParams,
  CreateBookingOrderDTO,
  UpdateBookingOrderDTO
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

export const bookingOrdersController = {
  async create(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreateBookingOrderDTO;
    const bookingOrder = await createBookingOrder(tenant.id, membership, user.id, input);

    return successResponse(c, bookingOrder, 'Booking order created', 201);
  },

  async list(c: Context<AppEnv>) {
    const { tenant, membership } = getTenantContext(c);
    const input = c.get('validatedQuery') as BookingOrderListQuery;
    const result = await listBookingOrders(tenant.id, membership, input);

    return paginatedResponse(c, result.items, result.meta, 'Booking orders retrieved');
  },

  async getByOrderNumber(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { orderNumber } = c.get('validatedParams') as BookingOrderNumberParams;
    const bookingOrder = await getBookingOrderByOrderNumber(tenant.id, membership, user.id, orderNumber);

    return successResponse(c, bookingOrder, 'Booking order retrieved');
  },

  async update(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { orderNumber } = c.get('validatedParams') as BookingOrderNumberParams;
    const input = c.get('validatedBody') as UpdateBookingOrderDTO;
    const bookingOrder = await updateBookingOrderByOrderNumber(tenant.id, membership, user.id, orderNumber, input);

    return successResponse(c, bookingOrder, 'Booking order updated');
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { orderNumber } = c.get('validatedParams') as BookingOrderNumberParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const bookingOrder = await deleteBookingOrderByOrderNumber(tenant.id, membership, user.id, orderNumber, lastKnownUpdatedAt);

    return successResponse(c, bookingOrder, 'Booking order deleted');
  },

  async listItems(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { orderNumber } = c.get('validatedParams') as BookingOrderNumberParams;
    const items = await listBookingOrderItems(tenant.id, membership, user.id, orderNumber);

    return successResponse(c, items, 'Booking order items retrieved');
  },

  async listAttendees(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { orderNumber } = c.get('validatedParams') as BookingOrderNumberParams;
    const input = c.get('validatedQuery') as BookingOrderAttendeesQuery;
    const result = await listBookingOrderAttendees(tenant.id, membership, user.id, orderNumber, input);

    return paginatedResponse(c, result.items, result.meta, 'Booking order attendees retrieved');
  },

  async assignAttendees(c: Context<AppEnv>) {
    const { tenant, membership, user } = getTenantContext(c);
    const { orderNumber } = c.get('validatedParams') as BookingOrderNumberParams;
    const input = c.get('validatedBody') as AssignBookingOrderAttendeesDTO;
    const assignments = await assignBookingOrderAttendees(tenant.id, membership, user.id, orderNumber, input);

    return successResponse(c, assignments, 'Booking order attendees assigned', 201);
  }
};