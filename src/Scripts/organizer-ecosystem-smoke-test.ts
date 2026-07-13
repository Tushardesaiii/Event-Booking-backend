// src/Scripts/organizer-ecosystem-smoke-test.ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { organizers, organizerLikes, organizerReviews, organizerSafetyProfiles, organizerVerifications, sosAlerts } from '../modules/organizer-profiles/schema.js';
import { events } from '../db/schema/events.js';
import { venues } from '../db/schema/venues.js';
import { trustedContacts, profileActivity, profiles } from '../db/schema/profile.js';
import { organizerFollows } from '../modules/follow-system/schema.js';

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

  // Sign up start
  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body
  });
  const startResult = extractSuccess(startResponse, `${displayName} signup start`);

  // Sign up verify
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
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: { name, description: `${name} tenant` }
  });
  return extractSuccess(response, `create tenant ${name}`).data;
}

async function createVenue(accessToken: string, tenantSlug: string, suffix: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      name: `Organizer Venue ${suffix}`,
      addressLine1: 'Vibe Street',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      capacity: 100
    }
  });
  return extractSuccess(response, 'create venue').data;
}

async function createEvent(
  accessToken: string,
  tenantSlug: string,
  venueId: string,
  organizerId: string,
  title: string,
  startDateTime: string,
  endDateTime: string
) {
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      title,
      shortDescription: 'Safety festival.',
      description: 'Festival with organizer safety testing.',
      startDateTime,
      endDateTime,
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId,
      organizerId,
      isFeatured: true
    }
  });
  return extractSuccess(response, 'create event').data;
}

async function run() {
  console.log('ORGANIZER ECOSYSTEM SMOKE TEST STARTING...');

  // 1. Setup Identities
  const owner = await signup('org_owner', 'Organizer Owner');
  const manager = await signup('org_manager', 'Organizer Manager');
  const staff = await signup('org_staff', 'Organizer Staff');
  const viewer = await signup('org_viewer', 'Organizer Viewer');
  const outsider = await signup('org_outsider', 'Organizer Outsider');

  const tenantA = await createTenant(owner.tokens.accessToken, 'Vibe Ahmedabad');
  const tenantB = await createTenant(outsider.tokens.accessToken, 'Vibe Surat');

  // Add Manager to Tenant A BEFORE creating profile
  const addManager = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: manager.user.id, role: 'manager' }
  });
  extractSuccess(addManager, 'add manager');

  // Add Staff to Tenant A
  const addStaff = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: staff.user.id, role: 'staff' }
  });
  extractSuccess(addStaff, 'add staff');

  // Add Viewer to Tenant A
  const addViewer = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: viewer.user.id, role: 'viewer' }
  });
  extractSuccess(addViewer, 'add viewer');

  // Create user profiles now that memberships are registered
  const usersToProfile = [
    { user: owner, slug: tenantA.slug },
    { user: manager, slug: tenantA.slug },
    { user: staff, slug: tenantA.slug },
    { user: viewer, slug: tenantA.slug },
    { user: outsider, slug: tenantB.slug }
  ];

  for (const item of usersToProfile) {
    const profRes = await request('/profiles', {
      method: 'POST',
      headers: authHeaders(item.user.tokens.accessToken, item.slug),
      body: {
        username: item.user.user.username,
        displayName: item.user.user.username
      }
    });
    extractSuccess(profRes, `Profile create for ${item.user.user.username}`);
  }

  // 2. CREATE ORGANIZER
  console.log('1. Creating organizer profile...');
  const createRes = await request<any>('/organizers', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      name: 'Alpha Productions',
      displayName: 'Alpha Productions Inc.',
      username: 'alphaprods',
      description: 'State of the art event organizers.',
      bio: 'Creating vibes since 2026.',
      website: 'https://alphaprods.example.com',
      instagram: 'https://instagram.com/alphaprods',
      facebook: 'https://facebook.com/alphaprods',
      twitterX: 'https://x.com/alphaprods',
      youtube: 'https://youtube.com/alphaprods',
      supportEmail: 'support@alphaprods.example.com',
      supportPhone: '+919999988888',
      emergencyHelplineNumber: '+919999911111',
      emergencyWhatsappNumber: '+919999922222',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India'
    }
  });
  const organizer = extractSuccess(createRes, 'create organizer').data;
  assert(organizer.slug.startsWith('alpha-productions'), 'Slug mismatch');
  assert(organizer.version === 0, 'Initial version must be 0');

  // 3. GET ORGANIZER DETAILS
  console.log('2. Fetching organizer details...');
  const getRes = await request<any>(`/organizers/${organizer.slug}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const details = extractSuccess(getRes, 'get organizer details').data;
  assert(details.id === organizer.id, 'Organizer ID mismatch');
  assert(details.followersCount === 0, 'Followers count should be 0');
  assert(details.likesCount === 0, 'Likes count should be 0');
  assert(details.totalEventsHosted === 0, 'Events count should be 0');
  assert(details.verificationStatus === 'pending', 'Verification status should be pending');

  // 4. UPDATE ORGANIZER & OCC CHECK
  console.log('3. Checking Optimistic Concurrency Control (OCC)...');
  
  // Successful update (version 0 matches)
  const updateRes1 = await request<any>(`/organizers/${organizer.slug}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      bio: 'Creating massive vibes since 2026.',
      version: 0,
      lastKnownUpdatedAt: organizer.updatedAt
    }
  });
  const updated1 = extractSuccess(updateRes1, 'update organizer success').data;
  assert(updated1.version === 1, 'Version should increment to 1');
  assert(updated1.bio === 'Creating massive vibes since 2026.', 'Bio not updated');

  // Stale update (using old version 0 should fail/conflict 409)
  const updateResStale = await request<any>(`/organizers/${organizer.slug}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      bio: 'This should fail.',
      version: 0,
      lastKnownUpdatedAt: organizer.updatedAt
    }
  });
  expectStatus(updateResStale, [409, 400], 'OCC stale check');

  // 5. FOLLOW SYSTEM
  console.log('4. Testing Follow system...');
  const followRes = await request<any>(`/organizers/${organizer.slug}/follow`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  expectStatus(followRes, [200, 201], 'follow organizer');

  // Get Followers
  const followersRes = await request<any>(`/organizers/${organizer.slug}/followers`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const followersList = extractSuccess(followersRes, 'get followers').data;
  assert(followersList.some((f: any) => f.userId === manager.user.id), 'Follower list should contain manager');

  // Get Following
  const followingRes = await request<any>(`/organizers/${organizer.slug}/following`, {
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  const followingList = extractSuccess(followingRes, 'get following').data;
  assert(followingList.some((f: any) => f.organizerId === organizer.id), 'Following list should contain organizer');

  // 6. LIKES SYSTEM
  console.log('5. Testing Likes system...');
  const likeRes = await request<any>(`/organizers/${organizer.slug}/like`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenantA.slug)
  });
  expectStatus(likeRes, [200, 201], 'like organizer');

  // Get Likes
  const likesRes = await request<any>(`/organizers/${organizer.slug}/likes`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const likesList = extractSuccess(likesRes, 'get likes').data;
  assert(likesList.some((l: any) => l.userId === manager.user.id), 'Likes list should contain manager');

  // 7. REVIEWS CRUD
  console.log('6. Testing Reviews CRUD...');
  const reviewRes = await request<any>(`/organizers/${organizer.slug}/reviews`, {
    method: 'POST',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: {
      rating: 5,
      title: 'Amazing Production',
      reviewText: 'Vibe check was perfect!'
    }
  });
  const review = extractSuccess(reviewRes, 'create review').data;
  assert(review.rating === 5, 'Review rating mismatch');
  assert(review.title === 'Amazing Production', 'Review title mismatch');

  // List Reviews and stats
  const listReviewsRes = await request<any>(`/organizers/${organizer.slug}/reviews`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const reviewsData = extractSuccess(listReviewsRes, 'get reviews').data;
  assert(reviewsData.reviews.some((r: any) => r.id === review.id), 'Reviews list should contain review');
  assert(reviewsData.stats.averageRating === 5, 'Average rating mismatch');
  assert(reviewsData.stats.ratingDistribution['5'] === 1, 'Rating distribution mismatch');

  // Update Review
  const updateReviewRes = await request<any>(`/organizers/reviews/${review.id}`, {
    method: 'PATCH',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: {
      rating: 4,
      title: 'Decent overall'
    }
  });
  const updatedReview = extractSuccess(updateReviewRes, 'update review').data;
  assert(updatedReview.rating === 4, 'Updated review rating mismatch');

  // Delete Review
  const deleteReviewRes = await request<any>(`/organizers/reviews/${review.id}`, {
    method: 'DELETE',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  expectStatus(deleteReviewRes, [200], 'delete review');

  // 8. TRUST SYSTEM (VERIFICATION)
  console.log('7. Testing trust/verification workflow...');
  const requestVerifyRes = await request<any>(`/organizers/${organizer.slug}/verification-request`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { reason: 'Government registered business entity.' }
  });
  const verifyRequest = extractSuccess(requestVerifyRes, 'submit verification request').data;
  assert(verifyRequest.status === 'pending', 'Verification status should be pending');

  // Approve request
  const approveRes = await request<any>(`/organizers/${organizer.slug}/verification`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug), // owner is tenant.manage role
    body: {
      status: 'verified',
      reason: 'Documents verified successfully.'
    }
  });
  expectStatus(approveRes, [200], 'approve verification request');

  const checkVerifiedRes = await request<any>(`/organizers/${organizer.slug}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const verifiedOrganizer = extractSuccess(checkVerifiedRes, 'get verified organizer').data;
  assert(verifiedOrganizer.verificationStatus === 'verified', 'Verification status should be verified');

  // 9. SAFETY PROFILE SETUP
  console.log('8. Testing safety profile configuration...');
  const safetyRes = await request<any>(`/organizers/${organizer.slug}/safety`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      emergencyHelplineNumber: '+919999900000',
      emergencyWhatsappNumber: '+919999911111',
      medicalHelpDeskInfo: 'Gate 2 medical booth',
      lostAndFoundDeskInfo: 'Main entrance check-in counter',
      womenSafetyDeskInfo: 'Gate A pink booth',
      securityDeskInfo: 'All gates security control'
    }
  });
  const safetyProfile = extractSuccess(safetyRes, 'upsert safety profile').data;
  assert(safetyProfile.medicalHelpDeskInfo === 'Gate 2 medical booth', 'Safety profile mismatch');

  // Get safety profile
  const getSafetyRes = await request<any>(`/organizers/${organizer.slug}/safety`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const fetchedSafety = extractSuccess(getSafetyRes, 'get safety profile').data;
  assert(fetchedSafety.womenSafetyDeskInfo === 'Gate A pink booth', 'Safety profile fetch mismatch');

  // 10. EVENT SAFETY INHERITANCE
  console.log('9. Testing Event safety profile inheritance...');
  const venue = await createVenue(owner.tokens.accessToken, tenantA.slug, 'A');
  const start = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const event = await createEvent(owner.tokens.accessToken, tenantA.slug, venue.id, organizer.id, 'Vibe Festival', start, end);

  // Directly link event to organizer in the DB for safety inheritance test
  await db
    .update(events)
    .set({ organizerId: organizer.id })
    .where(eq(events.id, event.id));

  // Fetch Event Safety profile (inherits from organizer safety profile)
  const eventSafetyRes = await request<any>(`/sos/event/${event.slug}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const eventSafety = extractSuccess(eventSafetyRes, 'get event safety').data;
  assert(eventSafety.medicalDesk === 'Gate 2 medical booth', 'Safety inheritance medical desk mismatch');
  assert(eventSafety.womenSafetyDesk === 'Gate A pink booth', 'Safety inheritance women safety desk mismatch');

  // 11. TRUSTED CONTACTS
  console.log('10. Testing trusted contacts API...');
  const contactRes = await request<any>('/profiles/me/trusted-contacts', {
    method: 'POST',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: {
      name: 'Dad',
      phone: '+919876543210',
      relationship: 'Father'
    }
  });
  const contact = extractSuccess(contactRes, 'add trusted contact');
  assert(contact.name === 'Dad', 'Contact name mismatch');

  const getContactsRes = await request<any>('/profiles/me/trusted-contacts', {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const contactsList = extractSuccess(getContactsRes, 'get trusted contacts');
  assert(contactsList.some((c: any) => c.id === contact.id), 'Trusted contacts list should contain Dad');

  // 12. SOS CENTER & ALERTS
  console.log('11. Testing SOS center issues & emergency alarms...');
  const reportIssueRes = await request<any>('/sos/report-issue', {
    method: 'POST',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: {
      eventId: event.id,
      organizerId: organizer.id,
      locationName: 'Near Stage A',
      latitude: '23.0225',
      longitude: '72.5714',
      issueCategory: 'security',
      severity: 'high',
      details: 'Unruly crowd pushing barriers.'
    }
  });
  expectStatus(reportIssueRes, [201], 'report issue');

  // Emergency Panic alarm (alerts trusted contacts)
  const emergencyRes = await request<any>('/sos/emergency-alert', {
    method: 'POST',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: {
      eventId: event.id,
      organizerId: organizer.id,
      latitude: '23.0225',
      longitude: '72.5714',
      issueCategory: 'harassment',
      severity: 'critical',
      details: 'Panic trigger emergency request.'
    }
  });
  const emergencyAlert = extractSuccess(emergencyRes, 'trigger emergency').data;
  assert(emergencyAlert.alert.issueCategory === 'harassment', 'Alert category mismatch');
  assert(emergencyAlert.notifiedContacts.some((c: any) => c.name === 'Dad'), 'Trusted contact Dad should be notified');

  // 13. DASHBOARD ANALYTICS
  console.log('12. Fetching organizer dashboard analytics...');
  const dashboardRes = await request<any>(`/organizers/${organizer.slug}/dashboard`, {
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug)
  });
  const dashboard = extractSuccess(dashboardRes, 'get organizer dashboard').data;
  assert(dashboard.followers === 1, 'Expected 1 follower');
  assert(dashboard.likes === 1, 'Expected 1 like');
  assert(dashboard.upcomingEvents === 1, 'Expected 1 upcoming event');

  // 14. ACTIVITY FEED
  console.log('13. Fetching organizer activity feed...');
  const activityRes = await request<any>(`/organizers/${organizer.slug}/activity`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const activityFeed = extractSuccess(activityRes, 'get activity feed').data;
  assert(activityFeed.items.length > 0, 'Activity feed should not be empty');

  // 15. DISCOVERY & SEARCH
  console.log('14. Testing discovery and search...');
  const trendingRes = await request<any>('/organizers/trending', {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const trending = extractSuccess(trendingRes, 'trending organizers').data;
  assert(trending.length > 0, 'Trending list should not be empty');

  const popularRes = await request<any>('/organizers/popular', {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const popular = extractSuccess(popularRes, 'popular organizers').data;
  assert(popular.length > 0, 'Popular list should not be empty');

  const recommendedRes = await request<any>('/organizers/recommended', {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const recommended = extractSuccess(recommendedRes, 'recommended organizers').data;
  assert(recommended.length > 0, 'Recommended list should not be empty');

  const searchRes = await request<any>('/organizers/search?search=Alpha', {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const searchResults = extractSuccess(searchRes, 'search organizers').data;
  assert(searchResults.some((org: any) => org.id === organizer.id), 'Search results should contain Alpha organizer');

  // 16. SECURITY RESTRICTIONS & TENANT ISOLATION
  console.log('15. Checking RBAC security and multi-tenant isolation...');

  // Outsider (Tenant B) cannot update Tenant A's organizer
  const outsiderUpdate = await request(`/organizers/${organizer.slug}`, {
    method: 'PATCH',
    headers: authHeaders(outsider.tokens.accessToken, tenantA.slug),
    body: { name: 'Hack Name', version: 1 }
  });
  expectStatus(outsiderUpdate, [403, 404], 'Outsider tenant access block');

  // Viewer (RBAC restriction) cannot update organizer profile
  const viewerUpdate = await request(`/organizers/${organizer.slug}`, {
    method: 'PATCH',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: { name: 'Viewer Hack', version: 1 }
  });
  expectStatus(viewerUpdate, [403], 'Viewer RBAC update permission block');

  // 17. SOFT DELETE
  console.log('16. Testing soft delete and cleanup...');
  const deleteRes = await request(`/organizers/${organizer.slug}`, {
    method: 'DELETE',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: verifiedOrganizer.updatedAt }
  });
  expectStatus(deleteRes, [200], 'delete organizer');

  // Fetching deleted organizer should return 404 Not Found
  const getDeletedRes = await request(`/organizers/${organizer.slug}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  expectStatus(getDeletedRes, [404], 'deleted organizer not found');

  // Clean up database records
  await db.transaction(async (tx) => {
    await tx.delete(sosAlerts).where(eq(sosAlerts.organizerId, organizer.id));
    await tx.delete(organizerSafetyProfiles).where(eq(organizerSafetyProfiles.organizerId, organizer.id));
    await tx.delete(organizerVerifications).where(eq(organizerVerifications.organizerId, organizer.id));
    await tx.delete(organizerReviews).where(eq(organizerReviews.organizerId, organizer.id));
    await tx.delete(organizerLikes).where(eq(organizerLikes.organizerId, organizer.id));
    await tx.delete(organizerFollows).where(eq(organizerFollows.organizerId, organizer.id));
    await tx.delete(events).where(eq(events.id, event.id));
    await tx.delete(venues).where(eq(venues.id, venue.id));
    await tx.delete(trustedContacts).where(eq(trustedContacts.name, 'Dad'));
    await tx.delete(organizers).where(eq(organizers.id, organizer.id));
  });

  console.log('\nORGANIZER ECOSYSTEM SMOKE TEST PASSED\n');
}

run().catch((error) => {
  console.error('\nORGANIZER ECOSYSTEM SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
