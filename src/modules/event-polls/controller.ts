import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import { castVote, createPoll, deletePoll, getPoll, updatePoll } from './service.js';
import type { CreatePollDTO, UpdatePollDTO, VotePollDTO, PollIdParams } from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const membership = c.get('tenantMembership');
  const user = c.get('user');

  if (!tenant || !membership || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, membership, user };
}

export const eventPollsController = {
  async create(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreatePollDTO;
    const poll = await createPoll(tenant.id, user.id, input);

    return successResponse(c, poll, 'Poll created successfully', 201);
  },

  async get(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as PollIdParams;
    const poll = await getPoll(tenant.id, id, user.id);

    return successResponse(c, poll, 'Poll retrieved');
  },

  async update(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as PollIdParams;
    const input = c.get('validatedBody') as UpdatePollDTO;
    const poll = await updatePoll(tenant.id, id, user.id, input);

    return successResponse(c, poll, 'Poll updated');
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as PollIdParams;
    const { lastKnownUpdatedAt } = c.get('validatedBody') as { lastKnownUpdatedAt: string };
    const poll = await deletePoll(tenant.id, id, user.id, lastKnownUpdatedAt);

    return successResponse(c, poll, 'Poll deleted');
  },

  async vote(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as PollIdParams;
    const input = c.get('validatedBody') as VotePollDTO;
    const result = await castVote(tenant.id, id, user.id, input);

    return successResponse(c, result, 'Vote recorded successfully');
  }
};
