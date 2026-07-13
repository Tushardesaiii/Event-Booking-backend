import { db } from '../../db/client.js';
import { forbidden, notFound, badRequest, conflict } from '../../lib/errors.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { findGroupPlanMember, listGroupPlanMembers } from '../group-plans/repository.js';
import { findGroupPlanById } from '../group-plans/repository.js';
import {
  createPollRecord,
  createPollOptionRecord,
  findPollById,
  findPollOptionById,
  getPollOptionsWithVotes,
  updatePollRecord,
  deactivatePollRecord,
  findUserVotesForPoll,
  createPollVoteRecord,
  deleteUserVotesForPoll
} from './repository.js';
import type {
  CreatePollDTO,
  UpdatePollDTO,
  VotePollDTO,
  PollDetailItem
} from './types.js';
import { createInAppNotification } from '../notifications/service.js';

async function assertGroupPlanMember(tenantId: string, groupPlanId: string, userId: string) {
  const plan = await findGroupPlanById(db, tenantId, groupPlanId);
  if (!plan) {
    throw notFound('Group plan not found');
  }

  const member = await findGroupPlanMember(db, groupPlanId, userId);
  if (!member) {
    throw forbidden('You are not a member of the associated group plan');
  }

  return plan;
}

export async function createPoll(
  tenantId: string,
  createdByUserId: string,
  input: CreatePollDTO
) {
  const plan = await assertGroupPlanMember(tenantId, input.groupPlanId, createdByUserId);

  return db.transaction(async (tx) => {
    const poll = await createPollRecord(tx, {
      tenantId,
      groupPlanId: input.groupPlanId,
      question: input.question,
      isAnonymous: input.isAnonymous ?? false,
      isPublic: input.isPublic ?? true,
      allowMultipleChoices: input.allowMultipleChoices ?? false,
      createdByUserId
    });

    if (!poll) {
      throw conflict('Unable to create poll');
    }

    for (const option of input.options) {
      await createPollOptionRecord(tx, poll.id, {
        optionText: option.optionText,
        eventId: option.eventId,
        dateOption: option.dateOption ? new Date(option.dateOption) : undefined
      });
    }

    const options = await getPollOptionsWithVotes(tx, poll.id, poll.isAnonymous);

    // Notify group plan members (except creator)
    const members = await listGroupPlanMembers(tx, input.groupPlanId);
    for (const member of members) {
      if (member.userId !== createdByUserId) {
        await createInAppNotification({
          tenantId,
          userId: member.userId,
          title: 'New Event Poll Created',
          message: `A new poll was created in "${plan.name}": "${poll.question}"`,
          type: 'poll_created',
          entityType: 'poll',
          entityId: poll.id,
          metadata: { groupPlanId: plan.id, question: poll.question }
        });
      }
    }

    return {
      ...poll,
      options
    };
  });
}

export async function getPoll(
  tenantId: string,
  id: string,
  userId: string
): Promise<PollDetailItem> {
  const poll = await findPollById(db, tenantId, id);
  if (!poll) {
    throw notFound('Poll not found');
  }

  await assertGroupPlanMember(tenantId, poll.groupPlanId, userId);

  const options = await getPollOptionsWithVotes(db, poll.id, poll.isAnonymous);

  return {
    ...poll,
    options
  };
}

export async function updatePoll(
  tenantId: string,
  id: string,
  actorUserId: string,
  input: UpdatePollDTO
) {
  return db.transaction(async (tx) => {
    const original = await findPollById(tx, tenantId, id);
    if (!original) {
      throw notFound('Poll not found');
    }

    const groupPlan = await assertGroupPlanMember(tenantId, original.groupPlanId, actorUserId);

    // Verify creator or admin/owner of the group plan
    const groupMember = await findGroupPlanMember(tx, original.groupPlanId, actorUserId);
    if (
      original.createdByUserId !== actorUserId &&
      groupMember?.role !== 'owner' &&
      groupMember?.role !== 'admin'
    ) {
      throw forbidden('You do not have permission to edit this poll');
    }

    const updated = await updatePollRecord(tx, tenantId, id, {
      ...input,
      updatedByUserId: actorUserId
    });

    assertOptimisticUpdate(updated);

    const options = await getPollOptionsWithVotes(tx, id, original.isAnonymous);

    // If poll closed, send notifications to members
    if (input.isClosed === true && original.isClosed === false) {
      const members = await listGroupPlanMembers(tx, original.groupPlanId);
      for (const member of members) {
        await createInAppNotification({
          tenantId,
          userId: member.userId,
          title: 'Poll Closed',
          message: `The poll "${original.question}" in "${groupPlan.name}" has been closed`,
          type: 'poll_closed',
          entityType: 'poll',
          entityId: id,
          metadata: { groupPlanId: groupPlan.id, question: original.question }
        });
      }
    }

    return {
      ...updated!,
      options
    };
  });
}

export async function deletePoll(
  tenantId: string,
  id: string,
  actorUserId: string,
  lastKnownUpdatedAt: string
) {
  const original = await findPollById(db, tenantId, id);
  if (!original) {
    throw notFound('Poll not found');
  }

  const groupMember = await findGroupPlanMember(db, original.groupPlanId, actorUserId);
  if (
    original.createdByUserId !== actorUserId &&
    groupMember?.role !== 'owner' &&
    groupMember?.role !== 'admin'
  ) {
    throw forbidden('You do not have permission to delete this poll');
  }

  const deleted = await deactivatePollRecord(db, tenantId, id, actorUserId, lastKnownUpdatedAt);
  assertOptimisticUpdate(deleted);

  return deleted;
}

export async function castVote(
  tenantId: string,
  pollId: string,
  userId: string,
  input: VotePollDTO
) {
  const poll = await findPollById(db, tenantId, pollId);
  if (!poll) {
    throw notFound('Poll not found');
  }

  if (poll.isClosed) {
    throw badRequest('This poll is closed and no longer accepting votes');
  }

  await assertGroupPlanMember(tenantId, poll.groupPlanId, userId);

  // Validate option IDs
  for (const optionId of input.optionIds) {
    const option = await findPollOptionById(db, optionId);
    if (!option || option.pollId !== pollId) {
      throw badRequest(`Invalid option ID: ${optionId}`);
    }
  }

  // Handle single vs multiple choice
  if (!poll.allowMultipleChoices && input.optionIds.length > 1) {
    throw badRequest('This poll only allows single choice votes');
  }

  return db.transaction(async (tx) => {
    // Delete previous votes for this user on this poll (clearing duplicate voting)
    await deleteUserVotesForPoll(tx, pollId, userId);

    // Cast new votes
    const votes = [];
    for (const optionId of input.optionIds) {
      const vote = await createPollVoteRecord(tx, pollId, optionId, userId);
      if (vote) {
        votes.push(vote);
      }
    }

    const options = await getPollOptionsWithVotes(tx, pollId, poll.isAnonymous);

    return {
      ...poll,
      options
    };
  });
}
