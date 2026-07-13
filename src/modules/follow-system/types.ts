import type { InferSelectModel } from 'drizzle-orm';
import type { userFollows, organizerFollows, artistFollows } from './schema.js';
import type { FollowParamsInput, FollowQueryInput } from './validation.js';

export type UserFollowRecord = InferSelectModel<typeof userFollows>;
export type OrganizerFollowRecord = InferSelectModel<typeof organizerFollows>;
export type ArtistFollowRecord = InferSelectModel<typeof artistFollows>;

export type FollowParams = FollowParamsInput;
export type FollowQuery = FollowQueryInput;
