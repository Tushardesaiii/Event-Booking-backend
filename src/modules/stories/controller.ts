import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  deleteStory,
  getStories,
  getStoryDetails,
  postStory,
  reactToStory,
  replyToStory,
  runStoriesCleanup,
  viewStory
} from './service.js';
import type {
  CreateStoryDTO,
  StoryReactionDTO,
  StoryReplyDTO,
  StoryListQuery,
  StoryIdParams
} from './types.js';

function getTenantContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const user = c.get('user');

  if (!tenant || !user) {
    throw forbidden('Tenant context is required');
  }

  return { tenant, user };
}

export const storiesController = {
  async create(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreateStoryDTO;
    const story = await postStory(tenant.id, user.id, input);

    return successResponse(c, story, 'Story posted successfully', 201);
  },

  async list(c: Context<AppEnv>) {
    const { tenant } = getTenantContext(c);
    const query = c.get('validatedQuery') as StoryListQuery;
    const result = await getStories(tenant.id, query);

    return paginatedResponse(c, result.items, result.meta, 'Active stories retrieved');
  },

  async get(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as StoryIdParams;
    const story = await getStoryDetails(tenant.id, id, user.id);

    return successResponse(c, story, 'Story details retrieved');
  },

  async view(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as StoryIdParams;
    const view = await viewStory(tenant.id, id, user.id);

    return successResponse(c, view, 'Story view recorded', 201);
  },

  async react(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as StoryIdParams;
    const input = c.get('validatedBody') as StoryReactionDTO;
    const reaction = await reactToStory(tenant.id, id, user.id, input);

    return successResponse(c, reaction, 'Reaction added to story', 201);
  },

  async reply(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as StoryIdParams;
    const input = c.get('validatedBody') as StoryReplyDTO;
    const reply = await replyToStory(tenant.id, id, user.id, input);

    return successResponse(c, reply, 'Reply sent to story', 201);
  },

  async delete(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as StoryIdParams;
    const story = await deleteStory(tenant.id, id, user.id);

    return successResponse(c, story, 'Story deleted');
  },

  async cleanup(c: Context<AppEnv>) {
    const result = await runStoriesCleanup();
    return successResponse(c, result, 'Stories cleanup execution completed');
  }
};
