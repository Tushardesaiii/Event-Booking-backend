import type { InferSelectModel } from 'drizzle-orm';
import type { groupPlans, groupPlanMembers, groupPlanInvites, groupPlanActivity } from './schema.js';
import type {
  CreateGroupPlanInput,
  UpdateGroupPlanInput,
  GroupPlanListQueryInput,
  GroupPlanIdParamsInput,
  GroupPlanInviteParamsInput,
  InviteMemberInput
} from './validation.js';

export type GroupPlanRecord = InferSelectModel<typeof groupPlans>;
export type GroupPlanMemberRecord = InferSelectModel<typeof groupPlanMembers>;
export type GroupPlanInviteRecord = InferSelectModel<typeof groupPlanInvites>;
export type GroupPlanActivityRecord = InferSelectModel<typeof groupPlanActivity>;

export type GroupPlanListItem = GroupPlanRecord & {
  membersCount: number;
};

export type GroupPlanDetailItem = GroupPlanRecord & {
  members: GroupPlanMemberRecord[];
};

export type GroupPlanListQuery = GroupPlanListQueryInput;
export type GroupPlanIdParams = GroupPlanIdParamsInput;
export type GroupPlanInviteParams = GroupPlanInviteParamsInput;
export type CreateGroupPlanDTO = CreateGroupPlanInput;
export type UpdateGroupPlanDTO = UpdateGroupPlanInput;
export type InviteMemberDTO = InviteMemberInput;
