import type { InferSelectModel } from 'drizzle-orm';
import type { eventPolls, eventPollOptions, eventPollVotes } from './schema.js';
import type {
  CreatePollInput,
  UpdatePollInput,
  VotePollInput,
  PollIdParamsInput
} from './validation.js';

export type PollRecord = InferSelectModel<typeof eventPolls>;
export type PollOptionRecord = InferSelectModel<typeof eventPollOptions>;
export type PollVoteRecord = InferSelectModel<typeof eventPollVotes>;

export type PollOptionItem = PollOptionRecord & {
  votesCount: number;
  voterUsernames?: string[]; // Populate if not anonymous
};

export type PollDetailItem = PollRecord & {
  options: PollOptionItem[];
};

export type PollIdParams = PollIdParamsInput;
export type CreatePollDTO = CreatePollInput;
export type UpdatePollDTO = UpdatePollInput;
export type VotePollDTO = VotePollInput;
