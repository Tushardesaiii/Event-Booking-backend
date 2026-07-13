// src/db/schema/artist.ts
import { pgTable, serial, uuid, varchar, text, timestamp, boolean, integer, jsonb, pgEnum, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { events } from './events.js';

// Helper enum for verification status
export const artistVerificationStatus = pgEnum('artist_verification_status', ['pending', 'verified', 'rejected'] as const);

export const artists = pgTable('artists', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Platform-global directory: NULL tenant = superadmin-owned. Organizer-created
  // artists keep their tenant for provenance but are visible to everyone.
  tenantId: uuid('tenant_id').references(() => tenants.id),
  // Who added this artist, and via which surface ('platform' | 'organizer').
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  source: varchar('source', { length: 20 }).notNull().default('platform'),
  slug: varchar('slug', { length: 255 }).notNull(),
  stageName: varchar('stage_name', { length: 255 }).notNull(),
  realName: varchar('real_name', { length: 255 }),
  bio: text('bio'),
  shortBio: text('short_bio'),
  profileImageUrl: varchar('profile_image_url', { length: 512 }),
  coverImageUrl: varchar('cover_image_url', { length: 512 }),
  city: varchar('city', { length: 255 }),
  state: varchar('state', { length: 255 }),
  country: varchar('country', { length: 255 }),
  genres: jsonb('genres').$type<string[]>(), // alternative, will also have join table
  languages: jsonb('languages').$type<string[]>(),
  instagramUrl: varchar('instagram_url', { length: 512 }),
  youtubeUrl: varchar('youtube_url', { length: 512 }),
  spotifyUrl: varchar('spotify_url', { length: 512 }),
  websiteUrl: varchar('website_url', { length: 512 }),
  bookingEmail: varchar('booking_email', { length: 255 }),
  managementContact: varchar('management_contact', { length: 255 }),
  verified: boolean('verified').notNull().default(false),
  // Platform governance gate: an artist is usable by event managers / visible in
  // the public app only once a superadmin approves it ('verified'). Organizer
  // contributions start 'pending'; superadmin-created artists start 'verified'.
  verificationStatus: artistVerificationStatus('verification_status').notNull().default('pending'),
  featured: boolean('featured').notNull().default(false),
  active: boolean('active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    slugIdx: uniqueIndex('artists_slug_unique_idx').on(table.tenantId, table.slug),
    tenantIdx: index('artists_tenant_idx').on(table.tenantId),
    deletedAtIdx: index('artists_deleted_at_idx').on(table.deletedAt),
    // Global, case-insensitive slug uniqueness across the whole platform.
    globalSlugIdx: uniqueIndex('artists_global_slug_unique_idx').on(sql`lower(${table.slug})`),
    stageNameIdx: index('artists_stage_name_idx').on(sql`lower(${table.stageName})`)
  };
});

export const artistGenres = pgTable('artist_genres', {
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  genreId: integer('genre_id').notNull().references(() => artistGenreLookup.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id)
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.artistId, table.genreId] }),
    idx: index('artist_genres_tenant_idx').on(table.tenantId)
  };
});

export const artistGenreLookup = pgTable('artist_genre_lookup', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull()
});

export const artistFollowers = pgTable('artist_followers', {
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.artistId, table.userId] }),
    idx: index('artist_followers_tenant_idx').on(table.tenantId),
    userIdx: index('artist_followers_user_idx').on(table.userId)
  };
});

export const eventArtists = pgTable('event_artists', {
  eventId: uuid('event_id').notNull().references(() => events.id),
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  headline: boolean('headline').notNull().default(false),
  displayOrder: integer('display_order').notNull().default(0),
  performanceType: varchar('performance_type', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.eventId, table.artistId] }),
    idx: index('event_artists_tenant_idx').on(table.tenantId),
    artistIdx: index('event_artists_artist_idx').on(table.artistId)
  };
});

export const artistStories = pgTable('artist_stories', {
  id: uuid('id').primaryKey().defaultRandom(),
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  mediaUrl: varchar('media_url', { length: 512 }).notNull(),
  caption: text('caption'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    idx: index('artist_stories_tenant_idx').on(table.tenantId),
    expiryIdx: index('artist_stories_expiry_idx').on(table.expiresAt),
    artistIdx: index('artist_stories_artist_idx').on(table.artistId)
  };
});

export const artistStoryViews = pgTable('artist_story_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  storyId: uuid('story_id').notNull().references(() => artistStories.id, { onDelete: 'restrict' }),
  viewerUserId: uuid('viewer_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    storyIdx: index('artist_story_views_story_idx').on(table.storyId),
    viewerIdx: index('artist_story_views_viewer_idx').on(table.viewerUserId),
    tenantIdx: index('artist_story_views_tenant_idx').on(table.tenantId)
  };
});

export const artistStoryReactions = pgTable('artist_story_reactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  storyId: uuid('story_id').notNull().references(() => artistStories.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reactionType: varchar('reaction_type', { length: 50 }).notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    storyIdx: index('artist_story_reactions_story_idx').on(table.storyId),
    userIdx: index('artist_story_reactions_user_idx').on(table.userId),
    tenantIdx: index('artist_story_reactions_tenant_idx').on(table.tenantId)
  };
});

export const artistAlerts = pgTable('artist_alerts', {
  userId: uuid('user_id').notNull().references(() => users.id),
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  radiusKm: integer('radius_km').notNull().default(50),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.userId, table.artistId] }),
    idx: index('artist_alerts_tenant_idx').on(table.tenantId),
    artistIdx: index('artist_alerts_artist_idx').on(table.artistId)
  };
});

export const artistVerifications = pgTable('artist_verifications', {
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  status: artistVerificationStatus('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewerId: uuid('reviewer_id').references(() => users.id)
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.artistId] }),
    idx: index('artist_verifications_tenant_idx').on(table.tenantId)
  };
});

// Relations
export const artistsRelations = relations(artists, ({ many }) => ({
  genres: many(artistGenres),
  followers: many(artistFollowers),
  events: many(eventArtists),
  stories: many(artistStories),
  alerts: many(artistAlerts),
  verification: many(artistVerifications)
}));

export const artistStoriesRelations = relations(artistStories, ({ many }) => ({
  views: many(artistStoryViews),
  reactions: many(artistStoryReactions)
}));
