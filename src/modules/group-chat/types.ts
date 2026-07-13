import type { InferSelectModel } from 'drizzle-orm';
import type {
  groupChatRooms,
  groupChatMembers,
  groupChatMessages,
  groupChatReactions,
  groupChatAttachments
} from './schema.js';
import type {
  CreateChatRoomInput,
  SendMessageInput,
  EditMessageInput,
  ReactMessageInput,
  MessageListQueryInput,
  ChatRoomIdParamsInput,
  ChatMessageIdParamsInput
} from './validation.js';

export type ChatRoomRecord = InferSelectModel<typeof groupChatRooms>;
export type ChatMemberRecord = InferSelectModel<typeof groupChatMembers>;
export type ChatMessageRecord = InferSelectModel<typeof groupChatMessages>;
export type ChatReactionRecord = InferSelectModel<typeof groupChatReactions>;
export type ChatAttachmentRecord = InferSelectModel<typeof groupChatAttachments>;

export type ChatMessageItem = ChatMessageRecord & {
  sender: {
    username: string;
    fullName: string;
    avatarAssetId: string | null;
  };
  attachments: ChatAttachmentRecord[];
  reactions: ChatReactionRecord[];
  replyTo?: {
    id: string;
    message: string;
    senderUsername: string;
  } | null;
};

export type ChatRoomIdParams = ChatRoomIdParamsInput;
export type ChatMessageIdParams = ChatMessageIdParamsInput;
export type CreateChatRoomDTO = CreateChatRoomInput;
export type SendMessageDTO = SendMessageInput;
export type EditMessageDTO = EditMessageInput;
export type ReactMessageDTO = ReactMessageInput;
export type MessageListQuery = MessageListQueryInput;
