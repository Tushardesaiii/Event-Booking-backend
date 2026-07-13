// Vibes matchmaking service. Real attendees only: candidates are other users who
// hold a confirmed booking for the same event AND opted into the matching mode.

import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { events } from '../../db/schema/events.js';
import { users } from '../../db/schema/users.js';
import { assets } from '../../db/schema/assets.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { cloudflareCdnService } from '../media/cloudflare-cdn.service.js';
import {
  vibeChatMessages,
  vibeGroupMembers,
  vibeGroups,
  vibeMatches,
  vibeParticipations,
  vibeProfiles,
  vibeSwipes,
} from './schema.js';
import { broadcastToRoom, type VibeRoomType } from './realtime.js';

const MAX_PARTNER_CHANGES = 3;
const MAX_GROUP_CHANGES = 3;
const GROUP_CAPACITY = 7; // members including the user
const CHAT_UNLOCK_MS = 72 * 60 * 60 * 1000;
// Vibes eligibility = the user holds an ACTIVE booking for the event. We include
// 'pending' (a placed-but-not-yet-captured order) alongside paid/confirmed so the
// "book a ticket → use Vibes" flow works even before the payment gateway settles;
// cancelled/expired/refunded/draft orders are intentionally excluded.
const CONFIRMED_BOOKING_STATUSES = ['confirmed', 'paid', 'completed', 'pending'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageFromDob(dob: string | null | undefined): number {
  if (!dob) return 0;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age > 0 && age < 120 ? age : 0;
}

function tagSet(tags: Record<string, string[]> | null | undefined, interests: string[] | null | undefined): Set<string> {
  const s = new Set<string>();
  if (tags) for (const arr of Object.values(tags)) for (const t of arr) s.add(t.toLowerCase());
  if (interests) for (const t of interests) s.add(t.toLowerCase());
  return s;
}

// Vibe-match % between two tag sets — Jaccard mapped into a believable 60–99 band.
function matchScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 70;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;
  return Math.min(99, 60 + Math.round(jaccard * 39));
}

function personalityTags(tags: Record<string, string[]> | null | undefined, interests: string[] | null | undefined): string[] {
  const out: string[] = [];
  if (tags) {
    for (const dim of ['energy', 'crowd', 'scenes']) {
      for (const t of tags[dim] ?? []) out.push(t);
    }
  }
  if (out.length < 3 && interests) out.push(...interests);
  return Array.from(new Set(out)).slice(0, 3);
}

interface ProfileRow {
  userId: string;
  fullName: string | null;
  bio: string | null;
  city: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  interests: string[] | null;
  phoneVerifiedAt: Date | null;
  avatarKey: string | null;
  tags: Record<string, string[]> | null;
  instagram: string | null;
  snapchat: string | null;
}

function buildProfile(eventId: string, row: ProfileRow, myTags: Set<string>, likesYou: boolean) {
  const theirTags = tagSet(row.tags, row.interests);
  const avatar = row.avatarKey
    ? cloudflareCdnService.buildPublicUrl(row.avatarKey)
    : `https://i.pravatar.cc/400?u=${encodeURIComponent(row.userId)}`;
  const g = row.gender === 'female' || row.gender === 'male' ? row.gender : 'male';
  return {
    id: `${eventId}-${row.userId}`,
    userId: row.userId,
    name: row.fullName ?? 'Guest',
    age: ageFromDob(row.dateOfBirth),
    gender: g as 'male' | 'female',
    city: row.city ?? '',
    avatar,
    bio: row.bio ?? '',
    matchScore: matchScore(myTags, theirTags),
    interests: Array.isArray(row.interests) ? row.interests : [],
    personalityTags: personalityTags(row.tags, row.interests),
    isVerified: !!row.phoneVerifiedAt,
    instagram: row.instagram ?? null,
    snapchat: row.snapchat ?? null,
    likesYou,
  };
}

async function chatUnlockAt(eventId: string): Promise<Date> {
  const [ev] = await db.select({ start: events.startDateTime }).from(events).where(eq(events.id, eventId)).limit(1);
  const start = ev?.start ? new Date(ev.start) : new Date(Date.now() + 7 * 864e5);
  return new Date(start.getTime() - CHAT_UNLOCK_MS);
}

async function hasConfirmedBooking(userId: string, eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: bookingOrders.id })
    .from(bookingOrders)
    .where(
      and(
        eq(bookingOrders.purchaserUserId, userId),
        eq(bookingOrders.eventId, eventId),
        inArray(bookingOrders.status, [...CONFIRMED_BOOKING_STATUSES]),
        isNull(bookingOrders.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

// Profiles for a set of userIds, joined with their vibe tags + avatar key.
async function profileRowsFor(userIds: string[]): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      bio: users.bio,
      city: users.city,
      gender: users.gender,
      dateOfBirth: users.dateOfBirth,
      interests: users.interests,
      phoneVerifiedAt: users.phoneVerifiedAt,
      avatarKey: assets.key,
      tags: vibeProfiles.tags,
      instagram: vibeProfiles.instagram,
      snapchat: vibeProfiles.snapchat,
    })
    .from(users)
    .leftJoin(assets, eq(assets.id, users.avatarAssetId))
    .leftJoin(vibeProfiles, and(eq(vibeProfiles.userId, users.id), isNull(vibeProfiles.deletedAt)))
    .where(inArray(users.id, userIds));
  const map = new Map<string, ProfileRow>();
  for (const r of rows) map.set(r.userId, r as ProfileRow);
  return map;
}

async function myTagSet(userId: string): Promise<Set<string>> {
  const [row] = await db
    .select({ tags: vibeProfiles.tags, interests: users.interests })
    .from(users)
    .leftJoin(vibeProfiles, and(eq(vibeProfiles.userId, users.id), isNull(vibeProfiles.deletedAt)))
    .where(eq(users.id, userId))
    .limit(1);
  return tagSet(row?.tags, row?.interests);
}

// ---------------------------------------------------------------------------
// Profile / onboarding
// ---------------------------------------------------------------------------

// Normalise a social handle: trim, drop a leading '@', strip spaces, cap length.
// Empty/whitespace becomes null (i.e. "unlink"). `undefined` means "leave as-is".
function normalizeHandle(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const cleaned = v.trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, 64);
  return cleaned.length ? cleaned : null;
}

export async function getVibeProfile(userId: string) {
  const [row] = await db.select().from(vibeProfiles).where(and(eq(vibeProfiles.userId, userId), isNull(vibeProfiles.deletedAt))).limit(1);
  return {
    onboarded: !!row?.onboarded,
    consented: !!row?.consentedAt,
    tags: row?.tags ?? {},
    instagram: row?.instagram ?? null,
    snapchat: row?.snapchat ?? null,
  };
}

export async function upsertVibeProfile(
  userId: string,
  input: { tags?: Record<string, string[]>; onboarded?: boolean; consented?: boolean; instagram?: string | null; snapchat?: string | null },
) {
  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now };
  if (input.tags) set.tags = input.tags;
  if (input.onboarded) set.onboarded = now;
  if (input.consented) set.consentedAt = now;
  const ig = normalizeHandle(input.instagram);
  const snap = normalizeHandle(input.snapchat);
  if (ig !== undefined) set.instagram = ig;
  if (snap !== undefined) set.snapchat = snap;

  await db
    .insert(vibeProfiles)
    .values({
      userId,
      tags: input.tags ?? {},
      instagram: ig ?? null,
      snapchat: snap ?? null,
      onboarded: input.onboarded ? now : null,
      consentedAt: input.consented ? now : null,
    })
    .onConflictDoUpdate({ target: vibeProfiles.userId, set });
  return getVibeProfile(userId);
}

// ---------------------------------------------------------------------------
// Participation (mode + attendance)
// ---------------------------------------------------------------------------

async function getOrCreateParticipation(userId: string, eventId: string) {
  const [existing] = await db
    .select()
    .from(vibeParticipations)
    .where(and(eq(vibeParticipations.userId, userId), eq(vibeParticipations.eventId, eventId), isNull(vibeParticipations.deletedAt)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(vibeParticipations)
    .values({ userId, eventId, mode: 'solo' })
    .onConflictDoUpdate({ target: [vibeParticipations.userId, vibeParticipations.eventId], set: { updatedAt: new Date() } })
    .returning();
  return created;
}

export async function setMode(userId: string, eventId: string, mode: 'solo' | 'partner' | 'group') {
  if (mode !== 'solo' && !(await hasConfirmedBooking(userId, eventId))) {
    throw forbidden('You need a confirmed booking for this event to find a partner or group.');
  }
  await getOrCreateParticipation(userId, eventId);
  await db
    .update(vibeParticipations)
    .set({ mode, attendance: null, updatedAt: new Date() })
    .where(and(eq(vibeParticipations.userId, userId), eq(vibeParticipations.eventId, eventId)));
  return getParticipation(userId, eventId);
}

export async function setAttendance(userId: string, eventId: string, attendance: 'going' | 'not_going') {
  await getOrCreateParticipation(userId, eventId);
  await db
    .update(vibeParticipations)
    .set({ attendance, updatedAt: new Date() })
    .where(and(eq(vibeParticipations.userId, userId), eq(vibeParticipations.eventId, eventId)));
  return getParticipation(userId, eventId);
}

export async function getParticipation(userId: string, eventId: string) {
  const [row] = await db
    .select()
    .from(vibeParticipations)
    .where(and(eq(vibeParticipations.userId, userId), eq(vibeParticipations.eventId, eventId), isNull(vibeParticipations.deletedAt)))
    .limit(1);
  return {
    eventId,
    mode: row?.mode ?? 'solo',
    attendance: row?.attendance ?? null,
    groupId: row?.groupId ?? null,
    partnerChangesUsed: row?.partnerChangesUsed ?? 0,
    groupChangesUsed: row?.groupChangesUsed ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Partner: candidates, swipe, matches
// ---------------------------------------------------------------------------

export async function getPartnerCandidates(userId: string, eventId: string, limit = 10) {
  if (!(await hasConfirmedBooking(userId, eventId))) {
    throw forbidden('You need a confirmed booking for this event to find a partner.');
  }
  await getOrCreateParticipation(userId, eventId);

  // Other attendees who opted into partner mode for this event.
  const attendeeRows = await db
    .selectDistinct({ userId: bookingOrders.purchaserUserId })
    .from(bookingOrders)
    .innerJoin(
      vibeParticipations,
      and(
        eq(vibeParticipations.userId, bookingOrders.purchaserUserId),
        eq(vibeParticipations.eventId, eventId),
        eq(vibeParticipations.mode, 'partner'),
        isNull(vibeParticipations.deletedAt),
      ),
    )
    .where(
      and(
        eq(bookingOrders.eventId, eventId),
        ne(bookingOrders.purchaserUserId, userId),
        inArray(bookingOrders.status, [...CONFIRMED_BOOKING_STATUSES]),
        isNull(bookingOrders.deletedAt),
      ),
    );
  const candidateIds = attendeeRows.map((r) => r.userId);
  if (candidateIds.length === 0) return [];

  // Exclude people I've already swiped, and people I've already matched with.
  const swiped = await db
    .select({ targetUserId: vibeSwipes.targetUserId })
    .from(vibeSwipes)
    .where(and(eq(vibeSwipes.eventId, eventId), eq(vibeSwipes.swiperUserId, userId)));
  const swipedSet = new Set(swiped.map((s) => s.targetUserId));

  const matched = await listMatchUserIds(userId, eventId);
  const excluded = new Set<string>([...swipedSet, ...matched]);
  const fresh = candidateIds.filter((id) => !excluded.has(id));
  if (fresh.length === 0) return [];

  // Who already swiped 'accept' on me → likesYou.
  const incoming = await db
    .select({ swiperUserId: vibeSwipes.swiperUserId })
    .from(vibeSwipes)
    .where(and(eq(vibeSwipes.eventId, eventId), eq(vibeSwipes.targetUserId, userId), eq(vibeSwipes.decision, 'accept'), inArray(vibeSwipes.swiperUserId, fresh)));
  const likesYouSet = new Set(incoming.map((i) => i.swiperUserId));

  const [myTags, rows] = await Promise.all([myTagSet(userId), profileRowsFor(fresh)]);
  const profiles = fresh
    .map((id) => rows.get(id))
    .filter((r): r is ProfileRow => !!r)
    .map((r) => buildProfile(eventId, r, myTags, likesYouSet.has(r.userId)));
  profiles.sort((a, b) => b.matchScore - a.matchScore);
  return profiles.slice(0, limit);
}

async function listMatchUserIds(userId: string, eventId: string): Promise<string[]> {
  const rows = await db
    .select({ a: vibeMatches.userAId, b: vibeMatches.userBId })
    .from(vibeMatches)
    .where(and(eq(vibeMatches.eventId, eventId), eq(vibeMatches.status, 'active'), or(eq(vibeMatches.userAId, userId), eq(vibeMatches.userBId, userId))));
  return rows.map((r) => (r.a === userId ? r.b : r.a));
}

export async function swipe(userId: string, eventId: string, targetUserId: string, decision: 'accept' | 'reject') {
  if (targetUserId === userId) throw badRequest('You cannot swipe on yourself.');
  if (!(await hasConfirmedBooking(userId, eventId))) {
    throw forbidden('You need a confirmed booking for this event to find a partner.');
  }
  await db
    .insert(vibeSwipes)
    .values({ eventId, swiperUserId: userId, targetUserId, decision })
    .onConflictDoUpdate({ target: [vibeSwipes.eventId, vibeSwipes.swiperUserId, vibeSwipes.targetUserId], set: { decision, updatedAt: new Date() } });

  if (decision !== 'accept') return { match: null };

  // Did the target already accept me? → mutual match.
  const [reciprocal] = await db
    .select({ id: vibeSwipes.id })
    .from(vibeSwipes)
    .where(and(eq(vibeSwipes.eventId, eventId), eq(vibeSwipes.swiperUserId, targetUserId), eq(vibeSwipes.targetUserId, userId), eq(vibeSwipes.decision, 'accept')))
    .limit(1);
  if (!reciprocal) return { match: null };

  const [userAId, userBId] = userId < targetUserId ? [userId, targetUserId] : [targetUserId, userId];
  const activatesAt = await chatUnlockAt(eventId);
  const [m] = await db
    .insert(vibeMatches)
    .values({ eventId, userAId, userBId, status: 'active', chatActivatesAt: activatesAt })
    .onConflictDoUpdate({ target: [vibeMatches.eventId, vibeMatches.userAId, vibeMatches.userBId], set: { status: 'active', updatedAt: new Date() } })
    .returning();

  const match = await hydrateMatch(userId, m);
  return { match };
}

async function hydrateMatch(viewerId: string, m: typeof vibeMatches.$inferSelect) {
  const otherId = m.userAId === viewerId ? m.userBId : m.userAId;
  const [myTags, rows] = await Promise.all([myTagSet(viewerId), profileRowsFor([otherId])]);
  const row = rows.get(otherId);
  const profile = row ? buildProfile(m.eventId, row, myTags, true) : null;
  return {
    id: m.id,
    eventId: m.eventId,
    eventTitle: await eventTitleOf(m.eventId),
    profile,
    matchedAt: (m.matchedAt instanceof Date ? m.matchedAt : new Date(m.matchedAt)).toISOString(),
    chatActivatesAt: (m.chatActivatesAt instanceof Date ? m.chatActivatesAt : new Date(m.chatActivatesAt)).toISOString(),
  };
}

export async function getMatches(userId: string, eventId?: string) {
  const conds = [eq(vibeMatches.status, 'active'), or(eq(vibeMatches.userAId, userId), eq(vibeMatches.userBId, userId))];
  if (eventId) conds.push(eq(vibeMatches.eventId, eventId));
  const rows = await db.select().from(vibeMatches).where(and(...conds)).orderBy(desc(vibeMatches.matchedAt));
  return Promise.all(rows.map((m) => hydrateMatch(userId, m)));
}

export async function changePartner(userId: string, eventId: string) {
  const part = await getOrCreateParticipation(userId, eventId);
  const used = part.partnerChangesUsed ?? 0;
  if (used >= MAX_PARTNER_CHANGES) return { changesLeft: 0 };
  // Re-roll: drop my reject swipes (keep accepts so I don't re-see matches) and
  // unmatch this event's matches so the deck refills.
  await db.delete(vibeSwipes).where(and(eq(vibeSwipes.eventId, eventId), eq(vibeSwipes.swiperUserId, userId), eq(vibeSwipes.decision, 'reject')));
  await db
    .update(vibeMatches)
    .set({ status: 'unmatched', updatedAt: new Date() })
    .where(and(eq(vibeMatches.eventId, eventId), or(eq(vibeMatches.userAId, userId), eq(vibeMatches.userBId, userId))));
  await db
    .update(vibeParticipations)
    .set({ partnerChangesUsed: used + 1, updatedAt: new Date() })
    .where(and(eq(vibeParticipations.userId, userId), eq(vibeParticipations.eventId, eventId)));
  return { changesLeft: MAX_PARTNER_CHANGES - (used + 1) };
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

async function hydrateGroup(viewerId: string, groupId: string) {
  const [g] = await db.select().from(vibeGroups).where(and(eq(vibeGroups.id, groupId), isNull(vibeGroups.deletedAt))).limit(1);
  if (!g) return null;
  const memberRows = await db
    .select({ userId: vibeGroupMembers.userId })
    .from(vibeGroupMembers)
    .where(and(eq(vibeGroupMembers.groupId, groupId), isNull(vibeGroupMembers.leftAt)));
  const memberIds = memberRows.map((r) => r.userId).filter((id) => id !== viewerId);
  const [myTags, rows] = await Promise.all([myTagSet(viewerId), profileRowsFor(memberIds)]);
  const members = memberIds
    .map((id) => rows.get(id))
    .filter((r): r is ProfileRow => !!r)
    .map((r) => buildProfile(g.eventId, r, myTags, false));
  const vibeScore = members.length ? Math.round(members.reduce((s, m) => s + m.matchScore, 0) / members.length) : 80;
  return {
    id: g.id,
    eventId: g.eventId,
    eventTitle: await eventTitleOf(g.eventId),
    name: g.name,
    members,
    vibeScore,
    chatActivatesAt: (g.chatActivatesAt instanceof Date ? g.chatActivatesAt : new Date(g.chatActivatesAt)).toISOString(),
  };
}

// All groups the user is currently a member of (across events) — for the tab.
export async function getMyGroups(userId: string) {
  const rows = await db
    .select({ groupId: vibeGroupMembers.groupId })
    .from(vibeGroupMembers)
    .where(and(eq(vibeGroupMembers.userId, userId), isNull(vibeGroupMembers.leftAt)));
  const out = [];
  for (const r of rows) {
    const g = await hydrateGroup(userId, r.groupId);
    if (g) out.push(g);
  }
  return out;
}

async function eventTitleOf(eventId: string): Promise<string> {
  const [ev] = await db.select({ title: events.title }).from(events).where(eq(events.id, eventId)).limit(1);
  return ev?.title ?? 'Your Event';
}

async function eventShortName(eventId: string): Promise<string> {
  return (await eventTitleOf(eventId)).split(/\s+/).slice(0, 3).join(' ');
}

// Place the user into a group with capacity, creating a new one if needed.
async function assignToGroup(userId: string, eventId: string, excludeGroupId?: string) {
  // Open groups for the event with free space and not the excluded one.
  const groups = await db.select().from(vibeGroups).where(and(eq(vibeGroups.eventId, eventId), isNull(vibeGroups.deletedAt)));
  for (const g of groups) {
    if (excludeGroupId && g.id === excludeGroupId) continue;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(vibeGroupMembers)
      .where(and(eq(vibeGroupMembers.groupId, g.id), isNull(vibeGroupMembers.leftAt)));
    if (Number(count) < GROUP_CAPACITY) {
      await addGroupMember(g.id, eventId, userId);
      return g.id;
    }
  }
  // None with space — create a new group.
  const short = await eventShortName(eventId);
  const seq = groups.length + 1;
  const activatesAt = await chatUnlockAt(eventId);
  const [created] = await db
    .insert(vibeGroups)
    .values({ eventId, name: `${short} · Squad ${seq}`, chatActivatesAt: activatesAt })
    .returning();
  await addGroupMember(created.id, eventId, userId);
  return created.id;
}

async function addGroupMember(groupId: string, eventId: string, userId: string) {
  await db
    .insert(vibeGroupMembers)
    .values({ groupId, eventId, userId })
    .onConflictDoUpdate({ target: [vibeGroupMembers.groupId, vibeGroupMembers.userId], set: { leftAt: null, joinedAt: new Date() } });
}

export async function joinGroup(userId: string, eventId: string) {
  if (!(await hasConfirmedBooking(userId, eventId))) {
    throw forbidden('You need a confirmed booking for this event to join a group.');
  }
  await setMode(userId, eventId, 'group');
  const part = await getParticipation(userId, eventId);
  if (part.groupId) {
    const existing = await hydrateGroup(userId, part.groupId);
    if (existing) return existing;
  }
  const groupId = await assignToGroup(userId, eventId);
  await db
    .update(vibeParticipations)
    .set({ groupId, mode: 'group', updatedAt: new Date() })
    .where(and(eq(vibeParticipations.userId, userId), eq(vibeParticipations.eventId, eventId)));
  return hydrateGroup(userId, groupId);
}

export async function changeGroup(userId: string, eventId: string) {
  const part = await getOrCreateParticipation(userId, eventId);
  const used = part.groupChangesUsed ?? 0;
  if (used >= MAX_GROUP_CHANGES) {
    const current = part.groupId ? await hydrateGroup(userId, eventId === eventId ? part.groupId : part.groupId) : null;
    return { group: current, changesLeft: 0 };
  }
  // Leave current group, join a different one.
  if (part.groupId) {
    await db
      .update(vibeGroupMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(vibeGroupMembers.groupId, part.groupId), eq(vibeGroupMembers.userId, userId)));
  }
  const groupId = await assignToGroup(userId, eventId, part.groupId ?? undefined);
  await db
    .update(vibeParticipations)
    .set({ groupId, groupChangesUsed: used + 1, updatedAt: new Date() })
    .where(and(eq(vibeParticipations.userId, userId), eq(vibeParticipations.eventId, eventId)));
  const group = await hydrateGroup(userId, groupId);
  return { group, changesLeft: MAX_GROUP_CHANGES - (used + 1) };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function assertRoomAccess(userId: string, roomType: VibeRoomType, roomId: string) {
  if (roomType === 'partner') {
    const [m] = await db
      .select()
      .from(vibeMatches)
      .where(and(eq(vibeMatches.id, roomId), eq(vibeMatches.status, 'active'), or(eq(vibeMatches.userAId, userId), eq(vibeMatches.userBId, userId))))
      .limit(1);
    if (!m) throw forbidden('You are not part of this chat.');
    return { eventId: m.eventId, activatesAt: m.chatActivatesAt as Date };
  }
  const [member] = await db
    .select({ eventId: vibeGroupMembers.eventId })
    .from(vibeGroupMembers)
    .where(and(eq(vibeGroupMembers.groupId, roomId), eq(vibeGroupMembers.userId, userId), isNull(vibeGroupMembers.leftAt)))
    .limit(1);
  if (!member) throw forbidden('You are not part of this group.');
  const [g] = await db.select({ activatesAt: vibeGroups.chatActivatesAt }).from(vibeGroups).where(eq(vibeGroups.id, roomId)).limit(1);
  return { eventId: member.eventId, activatesAt: (g?.activatesAt as Date) ?? new Date() };
}

export async function getChatMessages(userId: string, roomType: VibeRoomType, roomId: string, limit = 100) {
  await assertRoomAccess(userId, roomType, roomId);
  const rows = await db
    .select({
      id: vibeChatMessages.id,
      senderUserId: vibeChatMessages.senderUserId,
      body: vibeChatMessages.body,
      createdAt: vibeChatMessages.createdAt,
      senderName: users.fullName,
    })
    .from(vibeChatMessages)
    .leftJoin(users, eq(users.id, vibeChatMessages.senderUserId))
    .where(and(eq(vibeChatMessages.roomType, roomType), eq(vibeChatMessages.roomId, roomId)))
    .orderBy(desc(vibeChatMessages.createdAt))
    .limit(limit);
  return rows
    .map((r) => ({
      id: r.id,
      senderUserId: r.senderUserId,
      senderName: r.senderName ?? 'Member',
      body: r.body,
      isMine: r.senderUserId === userId,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    }))
    .reverse();
}

export async function sendChatMessage(userId: string, roomType: VibeRoomType, roomId: string, body: string) {
  const text = body.trim();
  if (!text) throw badRequest('Message cannot be empty.');
  const { activatesAt } = await assertRoomAccess(userId, roomType, roomId);
  if (Date.now() < new Date(activatesAt).getTime()) {
    throw forbidden('This chat unlocks 72 hours before the event.');
  }
  const [me] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  const [row] = await db
    .insert(vibeChatMessages)
    .values({ roomType, roomId, eventId: (await resolveRoomEventId(roomType, roomId)), senderUserId: userId, body: text })
    .returning();
  const message = {
    id: row.id,
    senderUserId: userId,
    senderName: me?.name ?? 'Member',
    body: text,
    isMine: false,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
  // Realtime fan-out to everyone else in the room.
  broadcastToRoom(roomType, roomId, { type: 'message', roomType, roomId, message }, { exceptUserId: userId });
  return { ...message, isMine: true };
}

async function resolveRoomEventId(roomType: VibeRoomType, roomId: string): Promise<string> {
  if (roomType === 'partner') {
    const [m] = await db.select({ eventId: vibeMatches.eventId }).from(vibeMatches).where(eq(vibeMatches.id, roomId)).limit(1);
    if (!m) throw notFound('Chat room not found.');
    return m.eventId;
  }
  const [g] = await db.select({ eventId: vibeGroups.eventId }).from(vibeGroups).where(eq(vibeGroups.id, roomId)).limit(1);
  if (!g) throw notFound('Chat room not found.');
  return g.eventId;
}

export { MAX_PARTNER_CHANGES, MAX_GROUP_CHANGES };
