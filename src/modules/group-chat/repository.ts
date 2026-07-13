import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  groupChatRooms,
  groupChatMembers,
  groupChatMessages,
  groupChatReactions,
  groupChatAttachments
} from './schema.js';
import { users } from '../../db/schema/users.js';
import type {
  CreateChatRoomDTO,
  SendMessageDTO,
  ChatRoomRecord,
  ChatMemberRecord,
  ChatMessageRecord,
  ChatReactionRecord,
  ChatAttachmentRecord
} from './types.js';

type DBInstance = typeof db | any;

export async function findChatRoomById(
  database: DBInstance,
  tenantId: string,
  id: string
) {
  const [room] = await database
    .select()
    .from(groupChatRooms)
    .where(and(eq(groupChatRooms.tenantId, tenantId), eq(groupChatRooms.id, id), isNull(groupChatRooms.deletedAt)))
    .limit(1);

  return room ?? null;
}

export async function findChatRoomByGroupPlanId(
  database: DBInstance,
  tenantId: string,
  groupPlanId: string
) {
  const [room] = await database
    .select()
    .from(groupChatRooms)
    .where(and(eq(groupChatRooms.tenantId, tenantId), eq(groupChatRooms.groupPlanId, groupPlanId), isNull(groupChatRooms.deletedAt)))
    .limit(1);

  return room ?? null;
}

export async function createChatRoomRecord(
  database: DBInstance,
  input: CreateChatRoomDTO & { tenantId: string; createdByUserId: string }
) {
  const [room] = await database
    .insert(groupChatRooms)
    .values({
      tenantId: input.tenantId,
      groupPlanId: input.groupPlanId,
      name: input.name,
      description: input.description ?? null,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.createdByUserId
    })
    .returning();

  return room ?? null;
}

export async function addChatRoomMember(
  database: DBInstance,
  roomId: string,
  userId: string,
  role: string
) {
  const [member] = await database
    .insert(groupChatMembers)
    .values({
      roomId,
      userId,
      role,
      joinedAt: new Date()
    })
    .returning();

  return member ?? null;
}

export async function findChatRoomMember(
  database: DBInstance,
  roomId: string,
  userId: string
) {
  const [member] = await database
    .select()
    .from(groupChatMembers)
    .where(and(eq(groupChatMembers.roomId, roomId), eq(groupChatMembers.userId, userId), isNull(groupChatMembers.deletedAt)))
    .limit(1);

  return member ?? null;
}

export async function findChatMessageById(
  database: DBInstance,
  id: string
) {
  const [msg] = await database
    .select()
    .from(groupChatMessages)
    .where(and(eq(groupChatMessages.id, id), isNull(groupChatMessages.deletedAt)))
    .limit(1);

  return msg ?? null;
}

export async function createChatMessageRecord(
  database: DBInstance,
  roomId: string,
  senderUserId: string,
  input: SendMessageDTO
) {
  const [msg] = await database
    .insert(groupChatMessages)
    .values({
      roomId,
      senderUserId,
      message: input.message,
      replyToMessageId: input.replyToMessageId ?? null,
      isEdited: false,
      createdByUserId: senderUserId,
      updatedByUserId: senderUserId
    })
    .returning();

  return msg ?? null;
}

export async function updateChatMessageRecord(
  database: DBInstance,
  id: string,
  senderUserId: string,
  message: string
) {
  const [msg] = await database
    .update(groupChatMessages)
    .set({
      message,
      isEdited: true,
      updatedByUserId: senderUserId,
      updatedAt: new Date()
    })
    .where(and(eq(groupChatMessages.id, id), eq(groupChatMessages.senderUserId, senderUserId), isNull(groupChatMessages.deletedAt)))
    .returning();

  return msg ?? null;
}

export async function deactivateChatMessageRecord(
  database: DBInstance,
  id: string,
  senderUserId: string
) {
  const [msg] = await database
    .update(groupChatMessages)
    .set({
      deletedAt: new Date(),
      updatedByUserId: senderUserId
    })
    .where(and(eq(groupChatMessages.id, id), eq(groupChatMessages.senderUserId, senderUserId), isNull(groupChatMessages.deletedAt)))
    .returning();

  return msg ?? null;
}

export async function addMessageReaction(
  database: DBInstance,
  messageId: string,
  userId: string,
  reaction: string
) {
  const [react] = await database
    .insert(groupChatReactions)
    .values({
      messageId,
      userId,
      reaction
    })
    .onConflictDoNothing()
    .returning();

  return react ?? null;
}

export async function deleteMessageReaction(
  database: DBInstance,
  messageId: string,
  userId: string,
  reaction: string
) {
  const [react] = await database
    .delete(groupChatReactions)
    .where(
      and(
        eq(groupChatReactions.messageId, messageId),
        eq(groupChatReactions.userId, userId),
        eq(groupChatReactions.reaction, reaction)
      )
    )
    .returning();

  return react ?? null;
}

export async function addMessageAttachment(
  database: DBInstance,
  messageId: string,
  attachment: { fileUrl: string; fileType?: string; fileName?: string; fileSize?: number }
) {
  const [attach] = await database
    .insert(groupChatAttachments)
    .values({
      messageId,
      fileUrl: attachment.fileUrl,
      fileType: attachment.fileType ?? null,
      fileName: attachment.fileName ?? null,
      fileSize: attachment.fileSize ?? null
    })
    .returning();

  return attach ?? null;
}

export async function getMessageReactions(
  database: DBInstance,
  messageId: string
) {
  return database
    .select()
    .from(groupChatReactions)
    .where(eq(groupChatReactions.messageId, messageId));
}

export async function getMessageAttachments(
  database: DBInstance,
  messageId: string
) {
  return database
    .select()
    .from(groupChatAttachments)
    .where(eq(groupChatAttachments.messageId, messageId));
}

export async function listChatMessages(
  database: DBInstance,
  roomId: string,
  pagination: { offset: number; limit: number }
) {
  const conditions = [eq(groupChatMessages.roomId, roomId), isNull(groupChatMessages.deletedAt)];
  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(groupChatMessages)
    .where(whereClause);

  const rows = await database
    .select({
      id: groupChatMessages.id,
      roomId: groupChatMessages.roomId,
      senderUserId: groupChatMessages.senderUserId,
      message: groupChatMessages.message,
      replyToMessageId: groupChatMessages.replyToMessageId,
      isEdited: groupChatMessages.isEdited,
      createdAt: groupChatMessages.createdAt,
      updatedAt: groupChatMessages.updatedAt,
      sender: {
        username: users.username,
        fullName: users.fullName,
        avatarAssetId: users.avatarAssetId
      }
    })
    .from(groupChatMessages)
    .innerJoin(users, eq(groupChatMessages.senderUserId, users.id))
    .where(whereClause)
    .orderBy(desc(groupChatMessages.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function getReplyMessageInfo(
  database: DBInstance,
  replyToMessageId: string
) {
  const [row] = await database
    .select({
      id: groupChatMessages.id,
      message: groupChatMessages.message,
      senderUsername: users.username
    })
    .from(groupChatMessages)
    .innerJoin(users, eq(groupChatMessages.senderUserId, users.id))
    .where(eq(groupChatMessages.id, replyToMessageId))
    .limit(1);

  return row ?? null;
}
