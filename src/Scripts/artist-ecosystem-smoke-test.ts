// src/Scripts/artist-ecosystem-smoke-test.ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { artists, artistFollowers, artistStories, artistAlerts, artistVerifications, eventArtists, artistGenres } from '../db/schema/artist.js';
import { events } from '../db/schema/events.js';
import { venues } from '../db/schema/venues.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

interface ApiError {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
}

interface RequestResult<T> {
  status: number;
  ok: boolean;
  data: T | ApiError | null;
  raw: string;
}

interface AuthResult {
  user: { id: string; username: string; email: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface TenantRecord { id: string; slug: string; name: string; }
interface VenueRecord { id: string; }
interface EventRecord { id: string; slug: string; }

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`}`);
  }
}

function headersToObject(headers?: HeadersInit) {
  return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
}

function authHeaders(accessToken: string, tenantSlug?: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, ...(tenantSlug ? { 'x-tenant-slug': tenantSlug } : {}) };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...headersToObject(options.headers) },
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  });

  const raw = await response.text();
  let data: T | ApiError | null = null;

  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as T | ApiError;
    } catch {
      data = null;
    }
  }

  if (VERBOSE) {
    console.log(`${response.status} ${options.method ?? 'GET'} ${path}`);
    if (raw.trim()) console.log(raw);
  }

  return { status: response.status, ok: response.ok, data, raw };
}

function extractSuccess<T>(result: RequestResult<T>, label: string): T {
  assert(result.ok, `${label} failed`, result.data ?? result.raw);
  return result.data as T;
}

function expectStatus(result: RequestResult<unknown>, statuses: number[], label: string) {
  assert(statuses.includes(result.status), `${label} expected ${statuses.join(', ')} but got ${result.status}`, result.data ?? result.raw);
}

async function signup(prefix: string, displayName: string) {
  const stamp = Date.now();
  const rand = Math.floor(100000000 + Math.random() * 900000000); // 9-digit random number
  const body = {
    fullName: displayName,
    username: `${prefix}_${stamp}_${Math.floor(Math.random() * 1000)}`,
    email: `${prefix}_${stamp}_${Math.floor(Math.random() * 1000)}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+1${rand}`
  };

  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body
  });
  const startResult = extractSuccess(startResponse, `${displayName} signup start`);

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId: startResult.data.verificationSessionId,
      code: '123456'
    }
  });
  const verifyResult = extractSuccess(verifyResponse, `${displayName} signup verify`);
  return verifyResult.data;
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', { method: 'POST', headers: authHeaders(accessToken), body: { name, description: `${name} tenant` } });
  return extractSuccess(response, `create tenant ${name}`).data;
}

async function createVenue(accessToken: string, tenantSlug: string, suffix: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: { name: `Artist Venue ${suffix}`, addressLine1: 'Artist Street', city: 'Ahmedabad', state: 'Gujarat', country: 'India', capacity: 100 }
  });
  return extractSuccess(response, 'create venue').data;
}

async function createEvent(
  accessToken: string,
  tenantSlug: string,
  venueId: string,
  title: string,
  startDateTime: string,
  endDateTime: string
) {
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      title,
      shortDescription: 'Festival artist event.',
      description: 'Massive festival with artists.',
      startDateTime,
      endDateTime,
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId,
      isFeatured: true
    }
  });
  return extractSuccess(response, 'create event').data;
}

async function run() {
  console.log('ARTIST ECOSYSTEM SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  // 1. Setup identities and isolated tenants
  const owner = await signup('art_owner', 'Artist Tenant Owner');
  const manager = await signup('art_manager', 'Artist Tenant Manager');
  const staff = await signup('art_staff', 'Artist Tenant Staff');
  const viewer = await signup('art_viewer', 'Artist Tenant Viewer');
  const outsider = await signup('art_outsider', 'Artist Tenant Outsider');

  const tenantA = await createTenant(owner.tokens.accessToken, 'Artist Ahmedabad Ops');
  const tenantB = await createTenant(outsider.tokens.accessToken, 'Artist Surat Ops');

  // Add members to tenantA
  const addManager = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: manager.user.id, role: 'manager' }
  });
  extractSuccess(addManager, 'add manager');

  const addViewer = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: viewer.user.id, role: 'viewer' }
  });
  extractSuccess(addViewer, 'add viewer');

  // Setup Event & Venue in tenantA
  const venue = await createVenue(owner.tokens.accessToken, tenantA.slug, 'A');
  const start = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const event = await createEvent(owner.tokens.accessToken, tenantA.slug, venue.id, 'Garba Concert', start, end);

  // 2. Create Artist
  console.log('Creating artist...');
  const createArtistRes = await request<any>('/artists', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      slug: 'tansen',
      stageName: 'Tansen the Great',
      realName: 'Ramtanu Pandey',
      bio: 'Legendary classical vocalist.',
      shortBio: 'Great vocalist.',
      profileImageUrl: 'https://example.com/tansen.jpg',
      coverImageUrl: 'https://example.com/cover.jpg',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      languages: ['Hindi', 'Sanskrit'],
      instagramUrl: 'https://instagram.com/tansen',
      youtubeUrl: 'https://youtube.com/tansen',
      websiteUrl: 'https://tansen.com',
      bookingEmail: 'booking@tansen.com',
      managementContact: '+919999999999',
      genres: ['Classical', 'Folk']
    }
  });
  const artist = extractSuccess(createArtistRes, 'create artist');
  assert(artist.slug === 'tansen', 'Slug mismatch');
  assert(artist.version === 0, 'OCC version must start at 0');

  // 3. Get Artist by Slug
  console.log('Fetching artist by slug...');
  const getArtistRes = await request<any>(`/artists/${artist.slug}`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const fetchedArtist = extractSuccess(getArtistRes, 'get artist');
  assert(fetchedArtist.id === artist.id, 'Fetched artist ID mismatch');

  // 4. Update Artist with OCC (Optimistic Concurrency Control)
  console.log('Updating artist (OCC check)...');
  
  // Successful update (version matches)
  const updateRes1 = await request<any>(`/artists/${artist.slug}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      bio: 'Legendary classical vocalist and composer.',
      version: 0
    }
  });
  const updatedArtist1 = extractSuccess(updateRes1, 'update artist 1');
  assert(updatedArtist1.version === 1, 'Version should increment to 1');
  assert(updatedArtist1.bio === 'Legendary classical vocalist and composer.', 'Bio was not updated');

  // Failed update (sending old version 0)
  const updateResConflict = await request<any>(`/artists/${artist.slug}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      bio: 'This update should fail.',
      version: 0
    }
  });
  // Should return empty response, null or error/400/409. In our controller, if no row is updated, it returns null or undefined.
  // We check that it didn't update the record (or it returned error/null).
  if (updateResConflict.status === 200) {
    assert(!updateResConflict.data, 'OCC conflict should return falsy or throw conflict error');
  }

  // 5. Follow Artist
  console.log('Testing follow endpoints...');
  const followRes = await request<any>(`/artists/${artist.slug}/follow`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  expectStatus(followRes, [200], 'follow artist');

  // Get Followers
  const followersRes = await request<any[]>(`/artists/${artist.slug}/followers`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const followers = extractSuccess(followersRes, 'get followers');
  assert(followers.some((f) => f.userId === manager.user.id), 'Follower list should contain manager');

  // Get Following
  const followingRes = await request<any[]>('/artists/me/following', {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const following = extractSuccess(followingRes, 'get following');
  assert(following.some((f) => f.artistId === artist.id), 'Following list should contain artist');

  // 6. Event-Artist Association
  console.log('Testing Event-Artist Association...');
  const assocRes = await request<any>(`/artists/${artist.slug}/events/${event.slug}`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { headline: true, displayOrder: 1, performanceType: 'Main Performer' }
  });
  expectStatus(assocRes, [201], 'associate event');

  const eventArtistsRes = await request<any[]>(`/artists/events/${event.slug}/artists`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const artistsForEvent = extractSuccess(eventArtistsRes, 'get artists for event');
  assert(artistsForEvent.some((a) => a.artistId === artist.id), 'Artists for event should contain artist');

  const artistEventsRes = await request<any[]>(`/artists/artists/${artist.slug}/events`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const eventsForArtist = extractSuccess(artistEventsRes, 'get events for artist');
  assert(eventsForArtist.some((e) => e.eventId === event.id), 'Events for artist should contain event');

  // 7. Stories API
  console.log('Testing stories API...');
  const createStoryRes = await request<any>(`/artists/${artist.slug}/stories`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { mediaUrl: 'https://example.com/story.mp4', caption: 'Tansen live rehearsal', type: 'video' }
  });
  const story = extractSuccess(createStoryRes, 'create story');

  const listStoriesRes = await request<any[]>(`/artists/${artist.slug}/stories`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const stories = extractSuccess(listStoriesRes, 'list stories');
  assert(stories.some((s) => s.id === story.id), 'Stories list should contain story');

  // Record a view on the story
  const viewStoryRes = await request<any>(`/artists/stories/${story.id}/view`, {
    method: 'POST',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  expectStatus(viewStoryRes, [201], 'record story view');

  // Record a reaction on the story
  const reactStoryRes = await request<any>(`/artists/stories/${story.id}/react`, {
    method: 'POST',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: { reactionType: '🔥' }
  });
  expectStatus(reactStoryRes, [201], 'record story reaction');

  const feedRes = await request<any[]>('/artists/stories/feed', {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const feed = extractSuccess(feedRes, 'stories feed');
  assert(feed.some((s) => s.id === story.id), 'Feed should contain story');

  // 8. Discovery, Trending, Recommendations
  console.log('Testing discovery, trending, and recommendations...');
  const discoverRes = await request<any[]>('/artists/discover?search=Tansen', {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const discover = extractSuccess(discoverRes, 'discover artists');
  assert(discover.length > 0, 'Discovery list should not be empty');

  const trendingRes = await request<any[]>('/artists/trending', {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const trending = extractSuccess(trendingRes, 'trending artists');
  assert(trending.length > 0, 'Trending list should not be empty');

  const recsRes = await request<any[]>('/artists/recommendations', {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const recs = extractSuccess(recsRes, 'recommends artists');
  assert(recs.length > 0, 'Recommendations should not be empty');

  // 9. Verification Workflow
  console.log('Testing verification workflow...');
  const verifyRequestRes = await request<any>(`/artists/${artist.slug}/verify`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug)
  });
  const verificationRequest = extractSuccess(verifyRequestRes, 'request verification');
  assert(verificationRequest.status === 'pending', 'Verification status should start as pending');

  const approveRes = await request<any>(`/artists/${artist.slug}/verify/approve`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug)
  });
  expectStatus(approveRes, [200], 'approve verification');

  const checkArtistVerified = await request<any>(`/artists/${artist.slug}`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const verifiedArtist = extractSuccess(checkArtistVerified, 'get verified artist');
  assert(verifiedArtist.verified === true, 'Artist verified flag should be true');

  // 10. Alerts API
  console.log('Testing alerts API...');
  const subscribeAlertRes = await request<any>(`/artists/${artist.slug}/alerts`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug),
    body: { radiusKm: 30, enabled: true }
  });
  const alert = extractSuccess(subscribeAlertRes, 'subscribe alert');
  assert(alert.radiusKm === 30, 'Alert radius mismatch');

  const getAlertsRes = await request<any[]>('/artists/alerts/me', {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const userAlerts = extractSuccess(getAlertsRes, 'user alerts list');
  assert(userAlerts.some((a) => a.artistId === artist.id), 'Alerts list should contain artist alert');

  // 11. Analytics Dashboard
  console.log('Testing analytics dashboard...');
  const analyticsRes = await request<any>(`/artists/${artist.slug}/analytics`, {
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug)
  });
  const analytics = extractSuccess(analyticsRes, 'get artist analytics');
  assert(analytics.followersCount === 1, 'Expected 1 follower');
  assert(analytics.activeStoriesCount === 1, 'Expected 1 active story');
  assert(analytics.upcomingEventsCount === 1, 'Expected 1 upcoming event');
  assert(analytics.storyViews === 1, 'Expected 1 story view');
  assert(analytics.storyEngagement === 1, 'Expected 1 story reaction/engagement');

  // 12. Security Checks
  console.log('Testing security restrictions...');
  
  // Outsider cannot access Ahmedabad tenant's artist analytics dashboard
  const outsiderAnalytics = await request(`/artists/${artist.slug}/analytics`, {
    headers: authHeaders(outsider.tokens.accessToken, tenantA.slug)
  });
  expectStatus(outsiderAnalytics, [403, 404], 'Outsider should be denied analytics access');

  // Viewer cannot update artist profile (RBAC restriction)
  const viewerUpdate = await request(`/artists/${artist.slug}`, {
    method: 'PATCH',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: { stageName: 'Attempt to update', version: 1 }
  });
  expectStatus(viewerUpdate, [403], 'Viewer should be denied update access');

  // 13. Soft Delete & Cleanup
  console.log('Cleaning up / Soft delete...');
  const deleteRes = await request(`/artists/${artist.slug}`, {
    method: 'DELETE',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug)
  });
  expectStatus(deleteRes, [200], 'delete artist');

  // Verify it is not findable anymore
  const getDeletedRes = await request(`/artists/${artist.slug}`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  expectStatus(getDeletedRes, [404], 'deleted artist should not be found');

  // Physically purge test entities from DB
  await db.transaction(async (tx) => {
    await tx.delete(artistAlerts).where(eq(artistAlerts.artistId, artist.id));
    await tx.delete(artistVerifications).where(eq(artistVerifications.artistId, artist.id));
    await tx.delete(artistStories).where(eq(artistStories.artistId, artist.id));
    await tx.delete(eventArtists).where(eq(eventArtists.artistId, artist.id));
    await tx.delete(artistFollowers).where(eq(artistFollowers.artistId, artist.id));
    await tx.delete(artistGenres).where(eq(artistGenres.artistId, artist.id));
    await tx.delete(artists).where(eq(artists.id, artist.id));
  });

  console.log('ARTIST ECOSYSTEM SMOKE TEST PASSED!');
}

run().catch((error) => {
  console.error('\nARTIST ECOSYSTEM SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
