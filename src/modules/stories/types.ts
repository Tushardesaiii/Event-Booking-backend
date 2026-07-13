import type { InferSelectModel } from 'drizzle-orm';
import type { stories, storyViews, storyReactions, storyReplies } from './schema.js';
import type {
  CreateStoryInput,
  StoryReplyInput,
  StoryReactionInput,
  StoryListQueryInput,
  StoryIdParamsInput
} from './validation.js';

export type StoryRecord = InferSelectModel<typeof stories>;
export type StoryViewRecord = InferSelectModel<typeof storyViews>;
export type StoryReactionRecord = InferSelectModel<typeof storyReactions>;
export type StoryReplyRecord = InferSelectModel<typeof storyReplies>;

export type StoryItem = StoryRecord & {
  creator: {
    username: string;
    fullName: string;
    avatarAssetId: string | null;
  };
  viewsCount: number;
  reactions: StoryReactionRecord[];
  replies: StoryReplyRecord[];
};

export type StoryIdParams = StoryIdParamsInput;
export type CreateStoryDTO = CreateStoryInput;
export type StoryReplyDTO = StoryReplyInput;
export type StoryReactionDTO = StoryReactionInput;
export type StoryListQuery = StoryListQueryInput;
