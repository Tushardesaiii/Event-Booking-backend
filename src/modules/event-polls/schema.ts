import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';
import { groupPlans } from '../group-plans/schema.js';
import { events } from '../../db/schema/events.js';

export const eventPolls = pgTable(
  'event_polls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    groupPlanId: uuid('group_plan_id').notNull().references(() => groupPlans.id, {
      onDelete: 'restrict'
    }),
    question: text('question').notNull(),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    isPublic: boolean('is_public').notNull().default(true),
    allowMultipleChoices: boolean('allow_multiple_choices').notNull().default(false),
    isClosed: boolean('is_closed').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('event_polls_tenant_id_idx').on(table.tenantId),
    groupPlanIdx: index('event_polls_group_plan_id_idx').on(table.groupPlanId)
  })
);

export const eventPollOptions = pgTable(
  'event_poll_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pollId: uuid('poll_id').notNull().references(() => eventPolls.id, {
      onDelete: 'restrict'
    }),
    optionText: text('option_text').notNull(),
    eventId: uuid('event_id').references(() => events.id, {
      onDelete: 'set null'
    }),
    dateOption: timestamp('date_option', {
      withTimezone: true,
      mode: 'date'
    }),
    ...timestampColumns
  },
  (table) => ({
    pollIdx: index('event_poll_options_poll_id_idx').on(table.pollId),
    eventIdx: index('event_poll_options_event_id_idx').on(table.eventId)
  })
);

export const eventPollVotes = pgTable(
  'event_poll_votes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pollId: uuid('poll_id').notNull().references(() => eventPolls.id, {
      onDelete: 'restrict'
    }),
    optionId: uuid('option_id').notNull().references(() => eventPollOptions.id, {
      onDelete: 'restrict'
    }),
    userId: uuid('user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    ...timestampColumns
  },
  (table) => ({
    pollIdx: index('event_poll_votes_poll_id_idx').on(table.pollId),
    optionIdx: index('event_poll_votes_option_id_idx').on(table.optionId),
    userIdx: index('event_poll_votes_user_id_idx').on(table.userId),
    uniqueVote: uniqueIndex('event_poll_votes_poll_usr_opt_unique').on(table.pollId, table.userId, table.optionId)
  })
);
