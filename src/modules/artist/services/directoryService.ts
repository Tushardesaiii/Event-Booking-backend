// Platform-global artist directory.
//
// One shared catalogue of artists used by three surfaces:
//   - superadmin  → full CRUD over every artist (tenant_id may be NULL)
//   - organizers  → search the directory + contribute new artists inline while
//                   building an event (their additions become visible to all)
//   - consumer app→ public list + detail for the Artists rail / artist screen
//
// Images (profile + cover) are uploaded as base64 to R2 and stored as durable
// CDN URLs — the same pipeline as event/organizer media — so they render on the
// dashboard and the phone without any tenant/quota coupling.

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import { artists, artistFollowers, eventArtists } from '../../../db/schema/artist.js';
import { r2Client } from '../../../lib/r2.js';
import { cloudflareCdnService } from '../../media/cloudflare-cdn.service.js';
import { badRequest, notFound } from '../../../lib/errors.js';
import { buildPaginationMeta } from '../../../lib/pagination.js';

export type ArtistSource = 'platform' | 'organizer';
export type ArtistVerificationStatus = 'pending' | 'verified' | 'rejected';

export interface ArtistInput {
  stageName: string;
  slug?: string;
  realName?: string | null;
  bio?: string | null;
  shortBio?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  genres?: string[];
  languages?: string[];
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
  spotifyUrl?: string | null;
  websiteUrl?: string | null;
  bookingEmail?: string | null;
  managementContact?: string | null;
  verified?: boolean;
  featured?: boolean;
  active?: boolean;
  /** base64 (optionally a data URI) profile photo to upload. */
  imageBase64?: string | null;
  /** base64 (optionally a data URI) cover photo to upload. */
  coverBase64?: string | null;
}

// --- helpers --------------------------------------------------------------

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 200) || 'artist'
  );
}

/** A slug unique across the WHOLE platform (case-insensitive, ignoring deletes). */
async function uniqueSlug(desired: string): Promise<string> {
  const base = slugify(desired);
  let slug = base;
  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db
      .select({ id: artists.id })
      .from(artists)
      .where(and(sql`lower(${artists.slug}) = ${slug}`, isNull(artists.deletedAt)))
      .limit(1);
    if (existing.length === 0) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

function parseImageInput(input: string): { mimeType: string; base64: string } {
  const match = /^data:([^;]+);base64,/.exec(input);
  const mimeType = match ? match[1] : 'image/jpeg';
  const base64 = input.replace(/^data:[^;]+;base64,/, '');
  return { mimeType, base64 };
}

async function uploadArtistImage(input: string, kind: 'profile' | 'cover'): Promise<string> {
  const { mimeType, base64 } = parseImageInput(input);
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw badRequest('Image is empty.');
  if (buffer.length > 8 * 1024 * 1024) throw badRequest('Image is too large (max 8MB).');
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const key = `artists/${kind}/${randomUUID()}/${Date.now()}.${ext}`;
  await r2Client.uploadObject(key, buffer, mimeType);
  return cloudflareCdnService.buildPublicUrl(key);
}

async function followerCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ artistId: artistFollowers.artistId, c: sql<number>`count(*)::int` })
    .from(artistFollowers)
    .where(inArray(artistFollowers.artistId, ids))
    .groupBy(artistFollowers.artistId);
  return new Map(rows.map((r) => [r.artistId, r.c]));
}

async function eventCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ artistId: eventArtists.artistId, c: sql<number>`count(*)::int` })
    .from(eventArtists)
    .where(inArray(eventArtists.artistId, ids))
    .groupBy(eventArtists.artistId);
  return new Map(rows.map((r) => [r.artistId, r.c]));
}

type ArtistRow = typeof artists.$inferSelect;

export function mapArtist(
  row: ArtistRow,
  extra?: { followerCount?: number; eventCount?: number },
) {
  return {
    id: row.id,
    slug: row.slug,
    stageName: row.stageName,
    realName: row.realName ?? null,
    bio: row.bio ?? null,
    shortBio: row.shortBio ?? null,
    photoUrl: row.profileImageUrl ?? null,
    coverUrl: row.coverImageUrl ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    country: row.country ?? null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    languages: Array.isArray(row.languages) ? row.languages : [],
    instagramUrl: row.instagramUrl ?? null,
    youtubeUrl: row.youtubeUrl ?? null,
    spotifyUrl: row.spotifyUrl ?? null,
    websiteUrl: row.websiteUrl ?? null,
    bookingEmail: row.bookingEmail ?? null,
    managementContact: row.managementContact ?? null,
    verified: row.verified,
    verificationStatus: (row.verificationStatus as ArtistVerificationStatus) ?? 'pending',
    featured: row.featured,
    active: row.active,
    source: (row.source as ArtistSource) ?? 'platform',
    followerCount: extra?.followerCount ?? 0,
    eventCount: extra?.eventCount ?? 0,
    createdAt: row.createdAt,
  };
}

export type ArtistDTO = ReturnType<typeof mapArtist>;

// Map the editable input fields onto a DB column patch (excludes images/slug,
// which are handled separately). Only defined keys are included.
function fieldsPatch(input: Partial<ArtistInput>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const assign = (k: keyof ArtistInput, col: string) => {
    if (input[k] !== undefined) patch[col] = input[k];
  };
  assign('stageName', 'stageName');
  assign('realName', 'realName');
  assign('bio', 'bio');
  assign('shortBio', 'shortBio');
  assign('city', 'city');
  assign('state', 'state');
  assign('country', 'country');
  assign('genres', 'genres');
  assign('languages', 'languages');
  assign('instagramUrl', 'instagramUrl');
  assign('youtubeUrl', 'youtubeUrl');
  assign('spotifyUrl', 'spotifyUrl');
  assign('websiteUrl', 'websiteUrl');
  assign('bookingEmail', 'bookingEmail');
  assign('managementContact', 'managementContact');
  assign('verified', 'verified');
  assign('featured', 'featured');
  assign('active', 'active');
  return patch;
}

// --- create / update / delete --------------------------------------------

export async function createDirectoryArtist(
  input: ArtistInput,
  ctx: { tenantId: string | null; createdByUserId: string | null; source: ArtistSource },
): Promise<ArtistDTO> {
  if (!input.stageName?.trim()) throw badRequest('Stage name is required.');

  const slug = await uniqueSlug(input.slug?.trim() || input.stageName);
  const profileImageUrl = input.imageBase64 ? await uploadArtistImage(input.imageBase64, 'profile') : null;
  const coverImageUrl = input.coverBase64 ? await uploadArtistImage(input.coverBase64, 'cover') : null;

  // Verification gate: organizer contributions always start 'pending' and are
  // unusable until a superadmin approves them. Superadmin (platform) creations are
  // trusted and land 'verified' unless the creator explicitly unchecked "verified".
  const verificationStatus: ArtistVerificationStatus =
    ctx.source === 'organizer' ? 'pending' : input.verified === false ? 'pending' : 'verified';
  const verified = verificationStatus === 'verified';

  const [row] = await db
    .insert(artists)
    .values({
      tenantId: ctx.tenantId,
      createdByUserId: ctx.createdByUserId,
      source: ctx.source,
      slug,
      stageName: input.stageName.trim(),
      realName: input.realName ?? null,
      bio: input.bio ?? null,
      shortBio: input.shortBio ?? null,
      profileImageUrl,
      coverImageUrl,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      genres: input.genres ?? [],
      languages: input.languages ?? [],
      instagramUrl: input.instagramUrl ?? null,
      youtubeUrl: input.youtubeUrl ?? null,
      spotifyUrl: input.spotifyUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      bookingEmail: input.bookingEmail ?? null,
      managementContact: input.managementContact ?? null,
      verified,
      verificationStatus,
      featured: input.featured ?? true,
      active: input.active ?? true,
    })
    .returning();

  return mapArtist(row);
}

export async function updateDirectoryArtist(id: string, input: Partial<ArtistInput>): Promise<ArtistDTO> {
  const patch = fieldsPatch(input);
  // Keep the governance status in lock-step with the "verified" toggle so the
  // superadmin edit form can't leave the two fields contradicting each other.
  if (input.verified !== undefined) patch.verificationStatus = input.verified ? 'verified' : 'pending';
  if (input.imageBase64) patch.profileImageUrl = await uploadArtistImage(input.imageBase64, 'profile');
  if (input.coverBase64) patch.coverImageUrl = await uploadArtistImage(input.coverBase64, 'cover');
  patch.updatedAt = new Date();
  patch.version = sql`${artists.version} + 1`;

  const [row] = await db
    .update(artists)
    .set(patch)
    .where(and(eq(artists.id, id), isNull(artists.deletedAt)))
    .returning();
  if (!row) throw notFound('Artist not found');
  return mapArtist(row);
}

/**
 * Superadmin verification decision. 'verified' makes the artist usable by event
 * managers and visible in the public app; 'rejected'/'pending' keep it hidden.
 * The `verified` boolean is kept in sync so all existing checks keep working.
 */
export async function setArtistVerification(
  id: string,
  status: ArtistVerificationStatus,
): Promise<ArtistDTO> {
  const [row] = await db
    .update(artists)
    .set({
      verificationStatus: status,
      verified: status === 'verified',
      updatedAt: new Date(),
      version: sql`${artists.version} + 1`,
    })
    .where(and(eq(artists.id, id), isNull(artists.deletedAt)))
    .returning();
  if (!row) throw notFound('Artist not found');
  return mapArtist(row);
}

export async function deleteDirectoryArtist(id: string): Promise<{ id: string }> {
  const [row] = await db
    .update(artists)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(artists.id, id), isNull(artists.deletedAt)))
    .returning({ id: artists.id });
  if (!row) throw notFound('Artist not found');
  return { id: row.id };
}

// --- reads ----------------------------------------------------------------

/** Typeahead for organizers: lightweight global search by stage name / city. */
export async function searchDirectory(params: { q?: string; limit?: number }): Promise<ArtistDTO[]> {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 25);
  // Event managers may only find (and therefore attach) superadmin-verified artists.
  const conditions = [isNull(artists.deletedAt), eq(artists.active, true), eq(artists.verificationStatus, 'verified')];
  if (params.q?.trim()) {
    const q = `%${params.q.trim()}%`;
    conditions.push(sql`(${artists.stageName} ILIKE ${q} OR ${artists.city} ILIKE ${q})`);
  }
  const rows = await db
    .select()
    .from(artists)
    .where(and(...conditions))
    .orderBy(desc(artists.verified), desc(artists.featured), asc(artists.stageName))
    .limit(limit);
  return rows.map((r) => mapArtist(r));
}

/** Superadmin paginated list with follower + event counts. */
export async function listDirectoryForAdmin(params: {
  search?: string;
  page?: number;
  limit?: number;
  verified?: boolean;
  featured?: boolean;
  status?: ArtistVerificationStatus;
}): Promise<{ items: ArtistDTO[]; meta: ReturnType<typeof buildPaginationMeta> }> {
  const page = Math.max(params.page ?? 1, 1);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const offset = (page - 1) * limit;

  const conditions = [isNull(artists.deletedAt)];
  if (params.search?.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(sql`(${artists.stageName} ILIKE ${q} OR ${artists.city} ILIKE ${q})`);
  }
  if (params.verified !== undefined) conditions.push(eq(artists.verified, params.verified));
  if (params.featured !== undefined) conditions.push(eq(artists.featured, params.featured));
  if (params.status !== undefined) conditions.push(eq(artists.verificationStatus, params.status));
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(artists)
    .where(where);

  const rows = await db
    .select()
    .from(artists)
    .where(where)
    // Surface the review queue first: pending artists float to the top.
    .orderBy(sql`(${artists.verificationStatus} = 'pending') desc`, desc(artists.createdAt))
    .limit(limit)
    .offset(offset);

  const ids = rows.map((r) => r.id);
  const [followers, events] = await Promise.all([followerCounts(ids), eventCounts(ids)]);
  const items = rows.map((r) =>
    mapArtist(r, { followerCount: followers.get(r.id) ?? 0, eventCount: events.get(r.id) ?? 0 }),
  );

  return { items, meta: buildPaginationMeta({ page, limit, total }) };
}

/** Public list for the app's Artists rail (featured + active first). */
export async function listPublicArtists(limit = 24): Promise<ArtistDTO[]> {
  const rows = await db
    .select()
    .from(artists)
    // Only superadmin-verified artists are shown to consumers.
    .where(and(isNull(artists.deletedAt), eq(artists.active, true), eq(artists.verificationStatus, 'verified')))
    .orderBy(desc(artists.featured), desc(artists.verified), desc(artists.createdAt))
    .limit(Math.min(Math.max(limit, 1), 60));
  const ids = rows.map((r) => r.id);
  const followers = await followerCounts(ids);
  return rows.map((r) => mapArtist(r, { followerCount: followers.get(r.id) ?? 0 }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findArtistRow(idOrSlug: string): Promise<ArtistRow | null> {
  const byId = UUID_RE.test(idOrSlug);
  const [row] = await db
    .select()
    .from(artists)
    .where(
      and(
        isNull(artists.deletedAt),
        byId ? eq(artists.id, idOrSlug) : sql`lower(${artists.slug}) = ${idOrSlug.toLowerCase()}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Public detail (by id or slug) with follower + event counts. */
export async function getPublicArtist(idOrSlug: string): Promise<ArtistDTO> {
  const row = await findArtistRow(idOrSlug);
  // Unverified (pending/rejected) artists are not publicly reachable.
  if (!row || row.verificationStatus !== 'verified') throw notFound('Artist not found');
  const [followers, events] = await Promise.all([followerCounts([row.id]), eventCounts([row.id])]);
  return mapArtist(row, {
    followerCount: followers.get(row.id) ?? 0,
    eventCount: events.get(row.id) ?? 0,
  });
}

/** Detail for admin/organizer surfaces (no active filter). */
export async function getDirectoryArtist(idOrSlug: string): Promise<ArtistDTO> {
  const row = await findArtistRow(idOrSlug);
  if (!row) throw notFound('Artist not found');
  return mapArtist(row);
}
