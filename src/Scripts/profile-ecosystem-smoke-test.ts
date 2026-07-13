// src/Scripts/profile-ecosystem-smoke-test.ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  profiles,
  profilePreferences,
  trustedContacts,
  profileInterests,
  profileSocialLinks,
  profileFollowers,
  profileBadges,
  profileAchievements,
  profileReviews,
  profileSavedEvents,
  profileActivity,
  profileVerificationRequests,
  buddyPreferences
} from '../db/schema/profile.js';
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
  const rand = Math.floor(100000000 + Math.random() * 900000000);
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
    body: { name: `Profile Venue ${suffix}`, addressLine1: 'Profile Street', city: 'Surat', state: 'Gujarat', country: 'India', capacity: 100 }
  });
  return extractSuccess(response, 'create venue').data;
}

async function createEvent(
  accessToken: string,
  tenantSlug: string,
  venueId: string,
  title: string
) {
  const start = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      title,
      shortDescription: 'Profile event description.',
      description: 'Profile event full description.',
      startDateTime: start,
      endDateTime: end,
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
  console.log('USER PROFILE ECOSYSTEM SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  // 1. Setup Identities
  const userA = await signup('prof_user_a', 'Profile User A');
  const userB = await signup('prof_user_b', 'Profile User B');
  const outsider = await signup('prof_outsider', 'Outsider User');

  const tenantA = await createTenant(userA.tokens.accessToken, 'Profile Tenant A');
  const tenantB = await createTenant(outsider.tokens.accessToken, 'Profile Tenant B');

  // Add user B to tenant A
  await request(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken),
    body: { userId: userB.user.id, role: 'viewer' }
  });

  // Create event/venue for reviews & saved events testing
  const venue = await createVenue(userA.tokens.accessToken, tenantA.slug, 'A');
  const event = await createEvent(userA.tokens.accessToken, tenantA.slug, venue.id, 'Garba Blast');

  // 2. Profile Creation (POST /profiles)
  console.log('Creating profiles...');
  const createProfileRes = await request<any>('/profiles', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: {
      username: 'harshil',
      displayName: 'Harshil Shah',
      bio: 'Loves Garba and code.',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      profileVisibility: 'public'
    }
  });
  const profileA = extractSuccess(createProfileRes, 'create profile A');
  assert(profileA.username === 'harshil', 'Username mismatch');
  assert(profileA.version === 0, 'Initial OCC version must be 0');

  const createProfileBRes = await request<any>('/profiles', {
    method: 'POST',
    headers: authHeaders(userB.tokens.accessToken, tenantA.slug),
    body: {
      username: 'rahul',
      displayName: 'Rahul Patel',
      bio: 'Enthusiastic event goer.',
      city: 'Surat',
      state: 'Gujarat',
      country: 'India',
      profileVisibility: 'followers_only' // Followers-only privacy test
    }
  });
  const profileB = extractSuccess(createProfileBRes, 'create profile B');

  // 3. Username Hardening & Validation
  console.log('Testing username hardening...');
  // Invalid username (uppercase)
  const invalidUser1 = await request('/profiles', {
    method: 'POST',
    headers: authHeaders(userB.tokens.accessToken, tenantA.slug),
    body: { username: 'InvalidUser', displayName: 'Invalid' }
  });
  expectStatus(invalidUser1, [400], 'reject uppercase username');

  // Invalid username (reserved word)
  const invalidUser2 = await request('/profiles', {
    method: 'POST',
    headers: authHeaders(userB.tokens.accessToken, tenantA.slug),
    body: { username: 'official', displayName: 'Official Vibe' }
  });
  expectStatus(invalidUser2, [400], 'reject reserved username');

  // Invalid username (too short)
  const invalidUser3 = await request('/profiles', {
    method: 'POST',
    headers: authHeaders(userB.tokens.accessToken, tenantA.slug),
    body: { username: 'hi', displayName: 'Hi' }
  });
  expectStatus(invalidUser3, [400], 'reject short username');

  // 4. Update Profile & OCC Conflicts
  console.log('Updating profile and testing OCC...');
  const updateRes1 = await request<any>('/profiles/me', {
    method: 'PATCH',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { bio: 'Loves Garba, music and code.', version: 0 }
  });
  const updatedA = extractSuccess(updateRes1, 'update profile A');
  assert(updatedA.version === 1, 'Version must increment to 1');

  // OCC conflict (sending old version 0)
  const updateResConflict = await request<any>('/profiles/me', {
    method: 'PATCH',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { bio: 'This update must fail.', version: 0 }
  });
  expectStatus(updateResConflict, [409], 'OCC conflict must return 409');

  // 5. Interests Management
  console.log('Testing interests management...');
  const addInterestRes = await request<any>('/profiles/me/interests', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { interest: 'Garba' }
  });
  const interestRow = extractSuccess(addInterestRes, 'add interest');

  const getInterestsRes = await request<any[]>('/profiles/me/interests', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const interestsList = extractSuccess(getInterestsRes, 'get interests');
  assert(interestsList.some((i) => i.interest === 'Garba'), 'Interest list must contain Garba');

  // 6. Social Links Management
  console.log('Testing social links...');
  const addSocialRes = await request<any>('/profiles/me/social-links', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { platform: 'Instagram', url: 'https://instagram.com/harshil' }
  });
  const linkRow = extractSuccess(addSocialRes, 'add social link');

  const getSocialRes = await request<any[]>('/profiles/me/social-links', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const socialList = extractSuccess(getSocialRes, 'get social links');
  assert(socialList.some((s) => s.platform === 'Instagram'), 'Platform Instagram missing');

  // 7. Profile Preferences
  console.log('Testing profile preferences...');
  const getPrefsRes = await request<any>('/profiles/me/preferences', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const prefs = extractSuccess(getPrefsRes, 'get preferences');

  const updatePrefsRes = await request<any>('/profiles/me/preferences', {
    method: 'PATCH',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { preferredCities: ['Surat', 'Ahmedabad'], discoveryRadiusKm: 100 }
  });
  const updatedPrefs = extractSuccess(updatePrefsRes, 'update preferences');
  assert(updatedPrefs.discoveryRadiusKm === 100, 'discoveryRadiusKm update fail');

  // 8. Buddy Preferences
  console.log('Testing buddy preferences...');
  const getBuddyPrefsRes = await request<any>('/profiles/me/buddy-preferences', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const buddyPrefs = extractSuccess(getBuddyPrefsRes, 'get buddy preferences');

  const updateBuddyPrefsRes = await request<any>('/profiles/me/buddy-preferences', {
    method: 'PATCH',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { enabled: true, bio: 'Looking for a Garba partner.', ageRangeMin: 21, ageRangeMax: 35 }
  });
  const updatedBuddyPrefs = extractSuccess(updateBuddyPrefsRes, 'update buddy preferences');
  assert(updatedBuddyPrefs.enabled === true, 'Buddy preferences enable fail');

  // 9. Trusted Contacts
  console.log('Testing trusted contacts...');
  const addContactRes = await request<any>('/profiles/me/trusted-contacts', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { name: 'Shah Family', phone: '+14155552671', relationship: 'Parent', isPrimary: true }
  });
  const contactRow = extractSuccess(addContactRes, 'add trusted contact');

  const getContactsRes = await request<any[]>('/profiles/me/trusted-contacts', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const contactsList = extractSuccess(getContactsRes, 'get trusted contacts');
  assert(contactsList.some((c) => c.name === 'Shah Family'), 'Contact name mismatch');

  // 10. Follow System & Privacy Checks
  console.log('Testing follows and privacy enforcement...');
  const followRes = await request<any>(`/profiles/${profileB.username}/follow`, {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  expectStatus(followRes, [200], 'follow user B');

  // Profile B has visibility "followers_only". Follower A should be able to view their public profile.
  const getProfileBRes = await request<any>(`/profiles/${profileB.username}`, {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const viewProfileB = extractSuccess(getProfileBRes, 'get profile B by follower A');

  // Outsider (not following B) should be blocked (403) from getting profile B
  const getProfileBBlock = await request<any>(`/profiles/${profileB.username}`, {
    headers: authHeaders(outsider.tokens.accessToken, tenantA.slug)
  });
  expectStatus(getProfileBBlock, [403], 'block outsider access to followers_only profile');

  // 11. Saved Events
  console.log('Testing saved events...');
  const saveEventRes = await request<any>('/profiles/me/saved-events', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { eventId: event.id }
  });
  expectStatus(saveEventRes, [201], 'save event');

  const getSavedRes = await request<any[]>('/profiles/me/saved-events', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const savedEventsList = extractSuccess(getSavedRes, 'get saved events');
  assert(savedEventsList.some((e) => e.eventId === event.id), 'Saved event missing');

  // 12. Reviews & Review Uniqueness Hardening
  console.log('Testing review creation and duplicate reviews hardening...');
  const reviewRes1 = await request<any>('/profiles/reviews', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { targetType: 'event', targetId: event.id, rating: 5, reviewText: 'Phenomenal Garba night!' }
  });
  const firstReview = extractSuccess(reviewRes1, 'create review');
  assert(firstReview.rating === 5, 'Rating mismatch');

  // Posting another review to same target should perform update (or upsert), rather than duplicate
  const reviewRes2 = await request<any>('/profiles/reviews', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { targetType: 'event', targetId: event.id, rating: 4, reviewText: 'Updated: great event!' }
  });
  const upsertReview = extractSuccess(reviewRes2, 'upsert review');
  assert(upsertReview.id === firstReview.id, 'Upsert must update the existing review record');
  assert(upsertReview.rating === 4, 'Rating update fail');

  // 13. Activity Feed with Cursor Pagination
  console.log('Testing activity feed with cursor...');
  const feedA = await request<any[]>('/profiles/me/activity', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const activities = extractSuccess(feedA, 'get activity feed');
  assert(activities.length > 0, 'Activity feed is empty');

  // Public Activity feed checks respect visibility settings
  const publicFeedBlock = await request<any>(`/profiles/${profileB.username}/activity`, {
    headers: authHeaders(outsider.tokens.accessToken, tenantA.slug)
  });
  expectStatus(publicFeedBlock, [403], 'block outsider activity feed read');

  // 14. Verification Workflow Requests
  console.log('Testing verification workflow requests...');
  const verifyRes = await request<any>('/profiles/me/verify', {
    method: 'POST',
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug),
    body: { verificationType: 'identity' }
  });
  const verReq = extractSuccess(verifyRes, 'verification request');
  assert(verReq.status === 'pending', 'Verification status should be pending');

  // 15. Analytics Dashboard
  console.log('Testing analytics dashboard...');
  const analyticsRes = await request<any>('/profiles/me/analytics', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const stats = extractSuccess(analyticsRes, 'get profile analytics');
  assert(stats.reviewsWritten === 1, 'Expected 1 review written');
  assert(stats.savedEvents === 1, 'Expected 1 saved event');
  assert(stats.badgeCount > 0, 'Expected at least 1 badge');

  // 16. Search Integration
  console.log('Testing search profiles...');
  const searchRes = await request<any[]>('/profiles/search?username=harshil', {
    headers: authHeaders(userA.tokens.accessToken, tenantA.slug)
  });
  const searchList = extractSuccess(searchRes, 'search profiles');
  assert(searchList.some((p) => p.username === 'harshil'), 'Search profiles must find harshil');

  // 17. Tenant Isolation
  console.log('Testing tenant isolation...');
  const outsiderPrefs = await request('/profiles/me/preferences', {
    headers: authHeaders(outsider.tokens.accessToken, tenantA.slug) // outsider using tenantA header
  });
  expectStatus(outsiderPrefs, [403, 404], 'deny outsider access to tenant A preferences');

  // 18. Cleanup
  console.log('Cleaning up smoke test entities...');
  await db.transaction(async (tx) => {
    // Delete profile interactions
    await tx.delete(profileVerificationRequests).where(eq(profileVerificationRequests.tenantId, tenantA.id));
    await tx.delete(profileActivity).where(eq(profileActivity.tenantId, tenantA.id));
    await tx.delete(profileSavedEvents).where(eq(profileSavedEvents.tenantId, tenantA.id));
    await tx.delete(profileReviews).where(eq(profileReviews.tenantId, tenantA.id));
    await tx.delete(profileAchievements).where(eq(profileAchievements.tenantId, tenantA.id));
    await tx.delete(profileBadges).where(eq(profileBadges.tenantId, tenantA.id));
    await tx.delete(profileFollowers).where(eq(profileFollowers.tenantId, tenantA.id));
    await tx.delete(profileSocialLinks).where(eq(profileSocialLinks.tenantId, tenantA.id));
    await tx.delete(profileInterests).where(eq(profileInterests.tenantId, tenantA.id));
    await tx.delete(trustedContacts).where(eq(trustedContacts.tenantId, tenantA.id));
    await tx.delete(buddyPreferences).where(eq(buddyPreferences.tenantId, tenantA.id));
    await tx.delete(profilePreferences).where(eq(profilePreferences.tenantId, tenantA.id));
    await tx.delete(profiles).where(eq(profiles.tenantId, tenantA.id));

    // Delete events and venues
    await tx.delete(events).where(eq(events.tenantId, tenantA.id));
    await tx.delete(venues).where(eq(venues.tenantId, tenantA.id));
  });

  console.log('USER PROFILE ECOSYSTEM SMOKE TEST PASSED!');
  process.exit(0);
}

run().catch((error) => {
  console.error('\nUSER PROFILE ECOSYSTEM SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
