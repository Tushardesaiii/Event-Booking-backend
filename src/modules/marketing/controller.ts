import type { Context } from 'hono';
import { errorResponse, successResponse, paginatedResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import { marketingSubscriberService } from './service.js';
import type { SubscribeInput, UnsubscribeInput, UpdateSubscriberInput, ListSubscribersQueryInput } from './validation.js';
import { badRequest, unauthorized } from '../../lib/errors.js';

export const marketingSubscriberController = {
  async subscribe(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as SubscribeInput;
    const tenant = c.get('tenant'); // Can be null for global subscription
    const tenantId = tenant?.id ?? null;

    const subscriber = await marketingSubscriberService.subscribe(input, tenantId);
    return successResponse(c, subscriber, 'Subscribed successfully', 201);
  },

  async unsubscribe(c: Context<AppEnv>) {
    const input = c.get('validatedBody') as UnsubscribeInput;
    const tenant = c.get('tenant');
    const tenantId = tenant?.id ?? null;

    const subscriber = await marketingSubscriberService.unsubscribe(input, tenantId);
    return successResponse(c, subscriber, 'Unsubscribed successfully');
  },

  async update(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Subscriber ID is required');
    }

    const input = c.get('validatedBody') as UpdateSubscriberInput;
    const tenant = c.get('tenant');
    const tenantId = tenant?.id ?? null;

    const updated = await marketingSubscriberService.updateSubscriber(id, input, tenantId);
    return successResponse(c, updated, 'Subscriber updated successfully');
  },

  async delete(c: Context<AppEnv>) {
    const id = c.req.param('id');
    if (!id) {
      throw badRequest('Subscriber ID is required');
    }

    const tenant = c.get('tenant');
    const tenantId = tenant?.id ?? null;

    const deleted = await marketingSubscriberService.deleteSubscriber(id, tenantId);
    return successResponse(c, deleted, 'Subscriber deleted successfully');
  },

  async list(c: Context<AppEnv>) {
    const query = c.get('validatedQuery') as ListSubscribersQueryInput;
    const tenant = c.get('tenant');
    const tenantId = tenant?.id ?? null;

    const user = c.get('user');
    if (!user) {
      throw unauthorized('Authentication required');
    }

    const result = await marketingSubscriberService.listSubscribers(query, user.id, tenantId);
    return paginatedResponse(c, result.items, result.meta, 'Subscribers retrieved');
  }
};
