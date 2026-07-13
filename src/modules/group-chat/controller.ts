import type { Context } from 'hono';

import { forbidden } from '../../lib/errors.js';
import { paginatedResponse, successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import {
  createChatRoom,
  deleteChatMessage,
  editChatMessage,
  getChatMessages,
  getChatRoom,
  reactToMessage,
  removeReaction,
  sendChatMessage
} from './service.js';
import type {
  CreateChatRoomDTO,
  SendMessageDTO,
  EditMessageDTO,
  ReactMessageDTO,
  MessageListQuery,
  ChatRoomIdParams,
  ChatMessageIdParams
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

export const groupChatController = {
  async createRoom(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const input = c.get('validatedBody') as CreateChatRoomDTO;
    const room = await createChatRoom(tenant.id, user.id, input);

    return successResponse(c, room, 'Chat room created successfully', 201);
  },

  async getRoom(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as ChatRoomIdParams;
    const room = await getChatRoom(tenant.id, id, user.id);

    return successResponse(c, room, 'Chat room retrieved');
  },

  async sendMessage(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as ChatRoomIdParams;
    const input = c.get('validatedBody') as SendMessageDTO;
    const message = await sendChatMessage(tenant.id, id, user.id, input);

    return successResponse(c, message, 'Message sent', 201);
  },

  async getMessages(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as ChatRoomIdParams;
    const query = c.get('validatedQuery') as MessageListQuery;
    const result = await getChatMessages(tenant.id, id, user.id, query);

    return paginatedResponse(c, result.items, result.meta, 'Messages retrieved');
  },

  async editMessage(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as ChatMessageIdParams;
    const input = c.get('validatedBody') as EditMessageDTO;
    const message = await editChatMessage(tenant.id, id, user.id, input);

    return successResponse(c, message, 'Message updated');
  },

  async deleteMessage(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as ChatMessageIdParams;
    const message = await deleteChatMessage(tenant.id, id, user.id);

    return successResponse(c, message, 'Message deleted');
  },

  async reactToMessage(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as ChatMessageIdParams;
    const { reaction } = c.get('validatedBody') as ReactMessageDTO;
    const react = await reactToMessage(tenant.id, id, user.id, reaction);

    return successResponse(c, react, 'Reaction added', 201);
  },

  async removeReaction(c: Context<AppEnv>) {
    const { tenant, user } = getTenantContext(c);
    const { id } = c.get('validatedParams') as ChatMessageIdParams;
    const { reaction } = c.get('validatedBody') as ReactMessageDTO;
    const react = await removeReaction(tenant.id, id, user.id, reaction);

    return successResponse(c, react, 'Reaction removed');
  }
};
