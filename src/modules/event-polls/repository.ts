import { and, asc, desc, eq, isNull, sql, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { eventPolls, eventPollOptions, eventPollVotes } from './schema.js';
import { users } from '../../db/schema/users.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type {
  CreatePollDTO,
  UpdatePollDTO,
  PollRecord,
  PollOptionRecord,
  PollVoteRecord,
  PollOptionItem
} from './types.js';

type DBInstance = typeof db | any;

const pollSelect = {
  id: eventPolls.id,
  tenantId: eventPolls.tenantId,
  groupPlanId: eventPolls.groupPlanId,
  question: eventPolls.question,
  isAnonymous: eventPolls.isAnonymous,
  isPublic: eventPolls.isPublic,
  allowMultipleChoices: eventPolls.allowMultipleChoices,
  isClosed: eventPolls.isClosed,
  createdByUserId: eventPolls.createdByUserId,
  updatedByUserId: eventPolls.updatedByUserId,
  createdAt: eventPolls.createdAt,
  updatedAt: eventPolls.updatedAt,
  deletedAt: eventPolls.deletedAt
} as const;

export async function findPollById(
  database: DBInstance,
  tenantId: string,
  id: string
) {
  const [poll] = await database
    .select(pollSelect)
    .from(eventPolls)
    .where(and(eq(eventPolls.tenantId, tenantId), eq(eventPolls.id, id), isNull(eventPolls.deletedAt)))
    .limit(1);

  return poll ?? null;
}

export async function findPollOptionById(
  database: DBInstance,
  id: string
) {
  const [option] = await database
    .select()
    .from(eventPollOptions)
    .where(eq(eventPollOptions.id, id))
    .limit(1);

  return option ?? null;
}

export async function createPollRecord(
  database: DBInstance,
  input: { tenantId: string; groupPlanId: string; question: string; isAnonymous: boolean; isPublic: boolean; allowMultipleChoices: boolean; createdByUserId: string }
) {
  const [poll] = await database
    .insert(eventPolls)
    .values({
      tenantId: input.tenantId,
      groupPlanId: input.groupPlanId,
      question: input.question,
      isAnonymous: input.isAnonymous,
      isPublic: input.isPublic,
      allowMultipleChoices: input.allowMultipleChoices,
      isClosed: false,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.createdByUserId
    })
    .returning(pollSelect);

  return poll ?? null;
}

export async function createPollOptionRecord(
  database: DBInstance,
  pollId: string,
  option: { optionText: string; eventId?: string; dateOption?: Date }
) {
  const [opt] = await database
    .insert(eventPollOptions)
    .values({
      pollId,
      optionText: option.optionText,
      eventId: option.eventId ?? null,
      dateOption: option.dateOption ?? null
    })
    .returning();

  return opt ?? null;
}

export async function updatePollRecord(
  database: DBInstance,
  tenantId: string,
  id: string,
  input: UpdatePollDTO & { updatedByUserId: string }
) {
  const [poll] = await database
    .update(eventPolls)
    .set({
      ...(input.question === undefined ? {} : { question: input.question }),
      ...(input.isClosed === undefined ? {} : { isClosed: input.isClosed }),
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(eventPolls.tenantId, tenantId),
        eq(eventPolls.id, id),
        optimisticLockCondition(eventPolls.updatedAt, input.lastKnownUpdatedAt),
        isNull(eventPolls.deletedAt)
      )
    )
    .returning(pollSelect);

  return poll ?? null;
}

export async function deactivatePollRecord(
  database: DBInstance,
  tenantId: string,
  id: string,
  updatedByUserId: string,
  lastKnownUpdatedAt: string
) {
  const [poll] = await database
    .update(eventPolls)
    .set({
      isClosed: true,
      updatedByUserId,
      updatedAt: new Date(),
      deletedAt: new Date()
    })
    .where(
      and(
        eq(eventPolls.tenantId, tenantId),
        eq(eventPolls.id, id),
        optimisticLockCondition(eventPolls.updatedAt, lastKnownUpdatedAt),
        isNull(eventPolls.deletedAt)
      )
    )
    .returning(pollSelect);

  return poll ?? null;
}

export async function findUserVotesForPoll(
  database: DBInstance,
  pollId: string,
  userId: string
) {
  return database
    .select()
    .from(eventPollVotes)
    .where(and(eq(eventPollVotes.pollId, pollId), eq(eventPollVotes.userId, userId)));
}

export async function createPollVoteRecord(
  database: DBInstance,
  pollId: string,
  optionId: string,
  userId: string
) {
  const [vote] = await database
    .insert(eventPollVotes)
    .values({
      pollId,
      optionId,
      userId
    })
    .returning();

  return vote ?? null;
}

export async function deleteUserVotesForPoll(
  database: DBInstance,
  pollId: string,
  userId: string
) {
  await database
    .delete(eventPollVotes)
    .where(and(eq(eventPollVotes.pollId, pollId), eq(eventPollVotes.userId, userId)));
}

export async function getPollOptions(
  database: DBInstance,
  pollId: string
) {
  return database
    .select()
    .from(eventPollOptions)
    .where(eq(eventPollOptions.pollId, pollId));
}

export async function getPollOptionsWithVotes(
  database: DBInstance,
  pollId: string,
  isAnonymous: boolean
) {
  const options = await getPollOptions(database, pollId);
  const optionIds = options.map((o: any) => o.id);

  if (optionIds.length === 0) {
    return [];
  }

  // Batch query counts
  const counts = await database
    .select({
      optionId: eventPollVotes.optionId,
      count: sql<number>`count(*)::int`
    })
    .from(eventPollVotes)
    .where(inArray(eventPollVotes.optionId, optionIds))
    .groupBy(eventPollVotes.optionId);

  const countsMap = new Map(counts.map((c: any) => [c.optionId, c.count]));

  // Batch query voter details if not anonymous
  const votersMap = new Map<string, string[]>();
  if (!isAnonymous) {
    const voters = await database
      .select({
        optionId: eventPollVotes.optionId,
        username: users.username
      })
      .from(eventPollVotes)
      .innerJoin(users, eq(eventPollVotes.userId, users.id))
      .where(inArray(eventPollVotes.optionId, optionIds));

    for (const v of voters) {
      const arr = votersMap.get(v.optionId) || [];
      arr.push(v.username);
      votersMap.set(v.optionId, arr);
    }
  }

  return options.map((option: any) => {
    const votesCount = countsMap.get(option.id) || 0;
    if (isAnonymous) {
      return {
        ...option,
        votesCount
      } as any;
    } else {
      return {
        ...option,
        votesCount,
        voterUsernames: votersMap.get(option.id) || []
      } as any;
    }
  });
}
