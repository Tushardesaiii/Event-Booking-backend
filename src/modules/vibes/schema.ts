// Vibes — consumer social matchmaking for events.
//
// A user who has a confirmed booking for an event can opt into "Vibes" and pick
// a mode: solo, find-a-partner (1:1 swipe → mutual match), or find-a-group.
// Matching is among REAL attendees only (other users with a confirmed booking
// for the same event who also opted in). Partner/group chat rooms unlock 72h
// before the event and deliver in realtime over websockets.

import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { events } from '../../db/schema/events.js';
import { users } from '../../db/schema/users.js';

export const vibeModeEnum = pgEnum('vibe_mode', ['solo', 'partner', 'group']);
export const vibeSwipeDecisionEnum = pgEnum('vibe_swipe_decision', ['accept', 'reject']);
export const vibeAttendanceEnum = pgEnum('vibe_attendance', ['going', 'not_going']);
export const vibeMatchStatusEnum = pgEnum('vibe_match_status', ['active', 'unmatched']);
export const vibeRoomTypeEnum = pgEnum('vibe_room_type', ['partner', 'group']);

// One row per user: their vibe onboarding tags + consent. Independent of event.
export const vibeProfiles = pgTable(
  'vibe_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Selected tags per dimension: { music:[], events:[], crowd:[], energy:[], scenes:[] }
    tags: jsonb('tags').$type<Record<string, string[]>>().notNull().default({}),
    // Optional social handles the user links during onboarding — shown on their
    // vibe profile so matches/squad-mates can connect. Stored bare (no '@').
    instagram: text('instagram'),
    snapchat: text('snapchat'),
    onboarded: timestamp('onboarded_at', { withTimezone: true, mode: 'date' }),
    consentedAt: timestamp('consented_at', { withTimezone: true, mode: 'date' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn,
  },
  (t) => ({
    userUnique: uniqueIndex('vibe_profiles_user_id_unique').on(t.userId),
  }),
);

// One row per (user, event): the user's chosen mode + attendance + re-roll usage.
export const vibeParticipations = pgTable(
  'vibe_participations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    mode: vibeModeEnum('mode').notNull().default('solo'),
    attendance: vibeAttendanceEnum('attendance'),
    groupId: uuid('group_id'),
    partnerChangesUsed: integer('partner_changes_used').notNull().default(0),
    groupChangesUsed: integer('group_changes_used').notNull().default(0),
    ...timestampColumns,
    deletedAt: softDeleteColumn,
  },
  (t) => ({
    userEventUnique: uniqueIndex('vibe_participations_user_event_unique').on(t.userId, t.eventId),
    eventModeIdx: index('vibe_participations_event_mode_idx').on(t.eventId, t.mode),
  }),
);

// A directional swipe: swiper -> target, for an event.
export const vibeSwipes = pgTable(
  'vibe_swipes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    swiperUserId: uuid('swiper_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    decision: vibeSwipeDecisionEnum('decision').notNull(),
    ...timestampColumns,
  },
  (t) => ({
    swipeUnique: uniqueIndex('vibe_swipes_event_swiper_target_unique').on(t.eventId, t.swiperUserId, t.targetUserId),
    targetIdx: index('vibe_swipes_event_target_idx').on(t.eventId, t.targetUserId),
  }),
);

// A confirmed mutual 1:1 match. userAId < userBId (lexicographic) so the pair is
// stored once regardless of who swiped first.
export const vibeMatches = pgTable(
  'vibe_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    userAId: uuid('user_a_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userBId: uuid('user_b_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: vibeMatchStatusEnum('status').notNull().default('active'),
    chatActivatesAt: timestamp('chat_activates_at', { withTimezone: true, mode: 'date' }).notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    ...timestampColumns,
  },
  (t) => ({
    pairUnique: uniqueIndex('vibe_matches_event_pair_unique').on(t.eventId, t.userAId, t.userBId),
    userAIdx: index('vibe_matches_user_a_idx').on(t.userAId),
    userBIdx: index('vibe_matches_user_b_idx').on(t.userBId),
  }),
);

// A vibe group for an event.
export const vibeGroups = pgTable(
  'vibe_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    chatActivatesAt: timestamp('chat_activates_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...timestampColumns,
    deletedAt: softDeleteColumn,
  },
  (t) => ({
    eventIdx: index('vibe_groups_event_idx').on(t.eventId),
  }),
);

export const vibeGroupMembers = pgTable(
  'vibe_group_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupId: uuid('group_id').notNull().references(() => vibeGroups.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => ({
    groupUserUnique: uniqueIndex('vibe_group_members_group_user_unique').on(t.groupId, t.userId),
    eventUserIdx: index('vibe_group_members_event_user_idx').on(t.eventId, t.userId),
  }),
);

// Chat messages for a partner-match room or a group room.
export const vibeChatMessages = pgTable(
  'vibe_chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomType: vibeRoomTypeEnum('room_type').notNull(),
    // matchId (partner) or groupId (group).
    roomId: uuid('room_id').notNull(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    senderUserId: uuid('sender_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    roomIdx: index('vibe_chat_messages_room_idx').on(t.roomType, t.roomId, t.createdAt),
  }),
);
