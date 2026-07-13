import { db } from '../../db/client.js';
import { forbidden, notFound, badRequest, conflict } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { auditLogs } from '../../db/schema/audit-logs.js';
import { findGroupPlanMember } from '../group-plans/repository.js';
import { findGroupPlanById } from '../group-plans/repository.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { groupChatReactions, groupChatAttachments, groupChatMessages } from './schema.js';
import { users } from '../../db/schema/users.js';
import {
  createChatRoomRecord,
  findChatRoomById,
  findChatRoomByGroupPlanId,
  addChatRoomMember,
  findChatRoomMember,
  createChatMessageRecord,
  findChatMessageById,
  updateChatMessageRecord,
  deactivateChatMessageRecord,
  addMessageReaction,
  deleteMessageReaction,
  addMessageAttachment,
  listChatMessages,
  getMessageReactions,
  getMessageAttachments,
  getReplyMessageInfo
} from './repository.js';
import type {
  CreateChatRoomDTO,
  SendMessageDTO,
  EditMessageDTO,
  MessageListQuery,
  ChatMessageItem
} from './types.js';
import { randomUUID } from 'node:crypto';

async function assertChatRoomAccess(tenantId: string, roomId: string, userId: string) {
  const room = await findChatRoomById(db, tenantId, roomId);
  if (!room) {
    throw notFound('Chat room not found');
  }

  if (room.groupPlanId) {
    const groupMember = await findGroupPlanMember(db, room.groupPlanId, userId);
    if (!groupMember) {
      throw forbidden('You must be a member of the associated group plan to access this chat');
    }
  } else {
    const chatMember = await findChatRoomMember(db, roomId, userId);
    if (!chatMember) {
      throw forbidden('You are not a member of this chat room');
    }
  }

  return room;
}

export async function createChatRoom(
  tenantId: string,
  createdByUserId: string,
  input: CreateChatRoomDTO
) {
  if (input.groupPlanId) {
    const groupPlan = await findGroupPlanById(db, tenantId, input.groupPlanId);
    if (!groupPlan) {
      throw notFound('Group plan not found');
    }

    const groupMember = await findGroupPlanMember(db, input.groupPlanId, createdByUserId);
    if (!groupMember) {
      throw forbidden('You must be a member of the group plan to create a chat room for it');
    }

    const existingRoom = await findChatRoomByGroupPlanId(db, tenantId, input.groupPlanId);
    if (existingRoom) {
      return existingRoom;
    }
  }

  return db.transaction(async (tx) => {
    const room = await createChatRoomRecord(tx, {
      ...input,
      tenantId,
      createdByUserId
    });

    if (!room) {
      throw conflict('Unable to create chat room');
    }

    // Add creator as member
    await addChatRoomMember(tx, room.id, createdByUserId, 'admin');

    // Audit log
    await tx.insert(auditLogs).values({
      eventType: 'campaign_created', // Reuse or map to standard event type
      actorType: 'user',
      actorUserId: createdByUserId,
      entityType: 'group_chat_room',
      entityId: room.id,
      correlationId: randomUUID(),
      metadata: { groupPlanId: input.groupPlanId, name: input.name }
    });

    return room;
  });
}

export async function getChatRoom(
  tenantId: string,
  id: string,
  userId: string
) {
  const room = await assertChatRoomAccess(tenantId, id, userId);
  return room;
}

export async function sendChatMessage(
  tenantId: string,
  roomId: string,
  senderUserId: string,
  input: SendMessageDTO
) {
  await assertChatRoomAccess(tenantId, roomId, senderUserId);

  return db.transaction(async (tx) => {
    const msg = await createChatMessageRecord(tx, roomId, senderUserId, input);
    if (!msg) {
      throw conflict('Unable to send message');
    }

    if (input.attachments && input.attachments.length > 0) {
      for (const attachment of input.attachments) {
        await addMessageAttachment(tx, msg.id, attachment);
      }
    }

    const reactions = await getMessageReactions(tx, msg.id);
    const attachments = await getMessageAttachments(tx, msg.id);
    const replyTo = input.replyToMessageId ? await getReplyMessageInfo(tx, input.replyToMessageId) : null;

    // Fetch user info for return shape
    const [senderInfo] = await tx
      .select({
        username: users.username,
        fullName: users.fullName,
        avatarAssetId: users.avatarAssetId
      })
      .from(users)
      .where(eq(users.id, senderUserId))
      .limit(1);

    return {
      ...msg,
      sender: senderInfo ?? { username: 'unknown', fullName: 'Unknown User', avatarAssetId: null },
      attachments,
      reactions,
      replyTo
    } as ChatMessageItem;
  });
}

export async function getChatMessages(
  tenantId: string,
  roomId: string,
  userId: string,
  query: MessageListQuery
) {
  await assertChatRoomAccess(tenantId, roomId, userId);

  const pagination = parsePagination(query);
  const { rows, total } = await listChatMessages(db, roomId, pagination);

  const messageIds = rows.map((r: any) => r.id);

  // Batch query reactions
  const reactions = messageIds.length > 0 ? await db
    .select()
    .from(groupChatReactions)
    .where(inArray(groupChatReactions.messageId, messageIds)) : [];

  const reactionsMap = new Map<string, any[]>();
  for (const r of reactions) {
    const arr = reactionsMap.get(r.messageId) || [];
    arr.push(r);
    reactionsMap.set(r.messageId, arr);
  }

  // Batch query attachments
  const attachments = messageIds.length > 0 ? await db
    .select()
    .from(groupChatAttachments)
    .where(inArray(groupChatAttachments.messageId, messageIds)) : [];

  const attachmentsMap = new Map<string, any[]>();
  for (const a of attachments) {
    const arr = attachmentsMap.get(a.messageId) || [];
    arr.push(a);
    attachmentsMap.set(a.messageId, arr);
  }

  // Batch query replyTo messages
  const replyToMessageIds = rows
    .map((r: any) => r.replyToMessageId)
    .filter((id: any): id is string => id !== null && id !== undefined);

  const replyToMessages = replyToMessageIds.length > 0 ? await db
    .select({
      id: groupChatMessages.id,
      message: groupChatMessages.message,
      senderUsername: users.username
    })
    .from(groupChatMessages)
    .innerJoin(users, eq(groupChatMessages.senderUserId, users.id))
    .where(inArray(groupChatMessages.id, replyToMessageIds)) : [];

  const replyToMap = new Map(replyToMessages.map((m: any) => [m.id, m]));

  const items = rows.map((row: any) => ({
    ...row,
    attachments: attachmentsMap.get(row.id) || [],
    reactions: reactionsMap.get(row.id) || [],
    replyTo: row.replyToMessageId ? (replyToMap.get(row.replyToMessageId) || null) : null
  }));

  return {
    items: items as ChatMessageItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function editChatMessage(
  tenantId: string,
  messageId: string,
  senderUserId: string,
  input: EditMessageDTO
) {
  const original = await findChatMessageById(db, messageId);
  if (!original) {
    throw notFound('Message not found');
  }

  await assertChatRoomAccess(tenantId, original.roomId, senderUserId);

  if (original.senderUserId !== senderUserId) {
    throw forbidden('You can only edit your own messages');
  }

  const updated = await updateChatMessageRecord(db, messageId, senderUserId, input.message);
  if (!updated) {
    throw conflict('Unable to update message');
  }

  return updated;
}

export async function deleteChatMessage(
  tenantId: string,
  messageId: string,
  senderUserId: string
) {
  const original = await findChatMessageById(db, messageId);
  if (!original) {
    throw notFound('Message not found');
  }

  await assertChatRoomAccess(tenantId, original.roomId, senderUserId);

  if (original.senderUserId !== senderUserId) {
    throw forbidden('You can only delete your own messages');
  }

  const deleted = await deactivateChatMessageRecord(db, messageId, senderUserId);
  if (!deleted) {
    throw conflict('Unable to delete message');
  }

  // Audit log message deletion
  await db.insert(auditLogs).values({
    eventType: 'campaign_cancelled', // Map to general cancellation
    actorType: 'user',
    actorUserId: senderUserId,
    entityType: 'group_chat_message',
    entityId: messageId,
    correlationId: randomUUID(),
    metadata: { roomId: original.roomId }
  });

  return deleted;
}

export async function reactToMessage(
  tenantId: string,
  messageId: string,
  userId: string,
  reaction: string
) {
  const msg = await findChatMessageById(db, messageId);
  if (!msg) {
    throw notFound('Message not found');
  }

  await assertChatRoomAccess(tenantId, msg.roomId, userId);

  const react = await addMessageReaction(db, messageId, userId, reaction);
  return react;
}

export async function removeReaction(
  tenantId: string,
  messageId: string,
  userId: string,
  reaction: string
) {
  const msg = await findChatMessageById(db, messageId);
  if (!msg) {
    throw notFound('Message not found');
  }

  await assertChatRoomAccess(tenantId, msg.roomId, userId);

  const deleted = await deleteMessageReaction(db, messageId, userId, reaction);
  return deleted;
}
