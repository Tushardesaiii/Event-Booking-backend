import type { InferSelectModel } from 'drizzle-orm';
import type { groupBookings, groupBookingMembers, groupBookingActivity } from './schema.js';
import type {
  createGroupBookingSchema,
  inviteMemberSchema,
  updateShareSchema,
  recordContributionSchema,
  groupBookingListQuerySchema
} from './validation.js';

export type GroupBookingRecord = InferSelectModel<typeof groupBookings>;
export type GroupBookingMemberRecord = InferSelectModel<typeof groupBookingMembers>;
export type GroupBookingActivityRecord = InferSelectModel<typeof groupBookingActivity>;

export type GroupBookingListItem = GroupBookingRecord & {
  membersCount: number;
};

export type GroupBookingDetailItem = GroupBookingRecord & {
  members: GroupBookingMemberRecord[];
};

export type GroupBookingListQuery = InferSelectModel<typeof groupBookings> & {
  page?: number;
  limit?: number;
  status?: string;
  eventId?: string;
};

export type CreateGroupBookingInput = typeof createGroupBookingSchema._input;
export type InviteMemberInput = typeof inviteMemberSchema._input;
export type UpdateShareInput = typeof updateShareSchema._input;
export type RecordContributionInput = typeof recordContributionSchema._input;
export type GroupBookingListQueryInput = typeof groupBookingListQuerySchema._input;
