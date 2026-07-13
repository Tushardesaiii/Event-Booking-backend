import { and, eq, isNull, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mediaAssets, mediaLinks } from '../modules/media/schema.js';
import { events } from '../db/schema/events.js';
import { venues } from '../db/schema/venues.js';
import { profiles, profileActivity, trustedContacts } from '../db/schema/profile.js';
import { artists } from '../db/schema/artist.js';
import { organizers, organizerReviews, organizerVerifications } from '../modules/organizer-profiles/schema.js';
import { stories } from '../modules/stories/schema.js';
import { ticketTypes } from '../db/schema/ticket-types.js';
import { groupBookings } from '../modules/group-bookings/schema.js';
import { marketingCampaigns } from '../db/schema/marketing-campaigns.js';
import { sosAlerts } from '../modules/organizer-profiles/schema.js';
import { bookingOrders } from '../db/schema/booking-orders.js';

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

async function createProfile(accessToken: string, tenantSlug: string, username: string, name: string) {
  const response = await request<any>('/profiles', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      username,
      displayName: name,
      bio: 'Smoke tester user profile.',
      profileVisibility: 'public'
    }
  });
  return extractSuccess(response, 'create profile');
}

async function run() {
  console.log('MEDIA PLATFORM SMOKE TEST STARTING...');

  // 1. Setup Identities and Tenants
  const owner = await signup('med_owner', 'Media Owner');
  const viewer = await signup('med_viewer', 'Media Viewer');
  const outsider = await signup('med_outsider', 'Outsider User');

  const tenantA = await createTenant(owner.tokens.accessToken, 'Media Tenant A');
  const tenantB = await createTenant(outsider.tokens.accessToken, 'Media Tenant B');

  // Add viewer to Tenant A
  await request(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: viewer.user.id, role: 'viewer' }
  });

  // Create User Profiles (so activity logs have reference to profiles.id)
  console.log('Setting up user profiles...');
  const ownerProf = await createProfile(owner.tokens.accessToken, tenantA.slug, `owner_${Date.now()}`, 'Media Owner');
  const viewerProf = await createProfile(viewer.tokens.accessToken, tenantA.slug, `viewer_${Date.now()}`, 'Media Viewer');
  const outsiderProf = await createProfile(outsider.tokens.accessToken, tenantB.slug, `outsider_${Date.now()}`, 'Outsider User');

  // 2. Upload URL Generation with validations
  console.log('Testing file rejections on /media/upload-url...');
  // File size too large (>50MB)
  const rejectSize = await request('/media/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      fileName: 'huge-video.mp4',
      mimeType: 'video/mp4',
      fileSize: 100 * 1024 * 1024, // 100MB
      entityType: 'event',
      role: 'promo_video'
    }
  });
  expectStatus(rejectSize, [400], 'Reject file larger than 50MB');

  // Invalid mime type
  const rejectMime = await request('/media/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      fileName: 'config.json',
      mimeType: 'application/json',
      fileSize: 1024,
      entityType: 'event',
      role: 'hero'
    }
  });
  expectStatus(rejectMime, [400], 'Reject non-image and non-video mime types');

  // Valid upload url generation (image)
  console.log('Generating upload URL...');
  const uploadUrlRes = await request<any>('/media/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      fileName: 'hero-banner.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2 * 1024 * 1024,
      entityType: 'event',
      role: 'hero'
    }
  });
  const uploadInfo = extractSuccess(uploadUrlRes, 'get upload url');
  assert(uploadInfo.uploadUrl, 'uploadUrl missing');
  assert(uploadInfo.storageKey, 'storageKey missing');

  // 3. Complete Upload
  console.log('Finalizing media asset registration...');
  const completeRes = await request<any>('/media/complete', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      storageKey: uploadInfo.storageKey,
      fileName: 'hero-banner.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2 * 1024 * 1024,
      width: 1920,
      height: 1080,
      checksum: 'chk-hero-123'
    }
  });
  const asset1 = extractSuccess(completeRes, 'complete upload');
  assert(asset1.id, 'Asset ID missing');
  assert(asset1.blurHash, 'BlurHash missing');
  assert(asset1.dominantColor, 'DominantColor missing');
  assert(asset1.urls.thumbnail, 'Thumbnail URL missing');
  assert(asset1.urls.original === asset1.cdnUrl, 'Original URL mismatch');

  // Check duplicate checksum handling
  console.log('Testing duplicate checksum deduplication...');
  const completeDupRes = await request<any>('/media/complete', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      storageKey: 'another-key.jpg',
      fileName: 'dup-banner.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2 * 1024 * 1024,
      width: 1920,
      height: 1080,
      checksum: 'chk-hero-123' // Same checksum
    }
  });
  const assetDup = extractSuccess(completeDupRes, 'complete duplicate upload');
  assert(assetDup.id === asset1.id, 'Duplicate checksum should resolve to same asset record');

  // 4. Media Retrieval
  console.log('Retrieving media asset details...');
  const getAssetRes = await request<any>(`/media/${asset1.id}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const retrieved = extractSuccess(getAssetRes, 'get media asset');
  assert(retrieved.id === asset1.id, 'Retrieved ID mismatch');
  assert(retrieved.cdnUrl === asset1.cdnUrl, 'CDN URL mismatch');
  assert(retrieved.width === 1920 && retrieved.height === 1080, 'Dimensions mismatch');
  assert(retrieved.fileSize === 2 * 1024 * 1024, 'File size mismatch');

  // 5. Setup test entities in Database for linking
  console.log('Seeding mock ecosystem entities...');
  // Venue & Event
  const [venue] = await db.insert(venues).values({
    tenantId: tenantA.id,
    name: 'Media Venue',
    slug: `media-venue-${Date.now()}`,
    addressLine1: 'Media St',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'India',
    capacity: 500,
    createdByUserId: owner.user.id
  }).returning();
  const [event] = await db.insert(events).values({
    tenantId: tenantA.id,
    venueId: venue.id,
    title: 'Media Fest',
    slug: `media-fest-${Date.now()}`,
    timezone: 'Asia/Kolkata',
    startDateTime: new Date(),
    endDateTime: new Date(Date.now() + 86400000)
  }).returning();

  // Artist
  const [artist] = await db.insert(artists).values({
    tenantId: tenantA.id,
    slug: `media-dj-${Date.now()}`,
    stageName: 'DJ Media'
  }).returning();

  // Organizer
  const [organizer] = await db.insert(organizers).values({
    tenantId: tenantA.id,
    name: 'Media Org Inc',
    slug: `media-org-${Date.now()}`
  }).returning();

  // Story
  const [story] = await db.insert(stories).values({
    tenantId: tenantA.id,
    ownerType: 'organizer',
    ownerId: organizer.id,
    mediaUrl: 'temp-url',
    mediaType: 'image',
    expiresAt: new Date(Date.now() + 86400000)
  }).returning();

  // Ticket Type
  const [ticket] = await db.insert(ticketTypes).values({
    tenantId: tenantA.id,
    eventId: event.id,
    name: 'General Admission',
    slug: `ga-${Date.now()}`,
    price: '999.00',
    totalQuantity: 100
  }).returning();

  // Booking Order
  const [order] = await db.insert(bookingOrders).values({
    tenantId: tenantA.id,
    eventId: event.id,
    purchaserUserId: owner.user.id,
    orderNumber: `ord-${Date.now()}`,
    currency: 'INR',
    totalAmount: '999.00',
    createdByUserId: owner.user.id
  }).returning();

  // Group Booking
  const [group] = await db.insert(groupBookings).values({
    tenantId: tenantA.id,
    eventId: event.id,
    bookingOrderId: order.id,
    createdByUserId: owner.user.id,
    title: 'Media Group'
  }).returning();

  // Marketing Campaign
  const [campaign] = await db.insert(marketingCampaigns).values({
    tenantId: tenantA.id,
    name: 'Media Promo Campaign',
    subject: 'Check out Vibe Media!',
    templateType: 'custom',
    status: 'draft',
    createdBy: owner.user.id
  }).returning();

  // SOS Alert
  const [sos] = await db.insert(sosAlerts).values({
    tenantId: tenantA.id,
    userId: viewer.user.id,
    eventId: event.id,
    organizerId: organizer.id,
    issueCategory: 'security',
    severity: 'high',
    details: 'SOS check'
  }).returning();

  // Organizer Reviews
  const [review] = await db.insert(organizerReviews).values({
    organizerId: organizer.id,
    reviewerUserId: viewer.user.id,
    rating: 5,
    comment: 'Exceptional organizer!'
  }).returning();

  // Organizer Verifications
  const [verification] = await db.insert(organizerVerifications).values({
    tenantId: tenantA.id,
    organizerId: organizer.id,
    status: 'pending',
    reason: 'Initial setup'
  }).returning();

  // 6. Generic Media Links Integration
  console.log('Testing Media Asset Linking across entities...');

  // Helper to link and assert
  async function testLink(entityType: string, entityId: string, role: string, displayOrder = 0, mediaAssetId = asset1.id) {
    const res = await request<any>('/media/link', {
      method: 'POST',
      headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
      body: {
        mediaAssetId,
        entityType,
        entityId,
        role,
        displayOrder
      }
    });
    const link = extractSuccess(res, `link media to ${entityType}`);
    assert(link.mediaAssetId === mediaAssetId, 'Link asset ID mismatch');
    assert(link.entityType === entityType, 'Link entityType mismatch');
    assert(link.role === role, 'Link role mismatch');
    return link;
  }

  // Link to all ecosystem roles
  await testLink('event', event.id, 'hero');
  await testLink('artist', artist.id, 'avatar');
  await testLink('artist', artist.id, 'cover');
  await testLink('organizer', organizer.id, 'avatar');
  await testLink('organizer', organizer.id, 'cover');
  await testLink('profile', viewerProf.id, 'avatar');
  await testLink('profile', viewerProf.id, 'cover');
  await testLink('story', story.id, 'story');
  await testLink('ticket_type', ticket.id, 'artwork');
  await testLink('group_booking', group.id, 'avatar');
  await testLink('group_booking', group.id, 'banner');
  await testLink('marketing_campaign', campaign.id, 'banner');
  await testLink('review', review.id, 'review_photo');
  await testLink('sos_report', sos.id, 'sos_evidence');
  await testLink('verification_request', verification.id, 'verification_document');

  // 7. Event Gallery & Ordering Checks
  console.log('Testing Event Gallery multi-image ordering...');
  // Upload two more assets for gallery
  const uploadGal1 = await request<any>('/media/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { fileName: 'gal1.jpg', mimeType: 'image/jpeg', fileSize: 1024, entityType: 'event', role: 'gallery' }
  });
  const infoGal1 = extractSuccess(uploadGal1, 'upload url gal1');
  const compGal1 = await request<any>('/media/complete', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { storageKey: infoGal1.storageKey, fileName: 'gal1.jpg', mimeType: 'image/jpeg', fileSize: 1024 }
  });
  const assetGal1 = extractSuccess(compGal1, 'complete gal1');

  const uploadGal2 = await request<any>('/media/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { fileName: 'gal2.jpg', mimeType: 'image/jpeg', fileSize: 1024, entityType: 'event', role: 'gallery' }
  });
  const infoGal2 = extractSuccess(uploadGal2, 'upload url gal2');
  const compGal2 = await request<any>('/media/complete', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { storageKey: infoGal2.storageKey, fileName: 'gal2.jpg', mimeType: 'image/jpeg', fileSize: 1024 }
  });
  const assetGal2 = extractSuccess(compGal2, 'complete gal2');

  // Link gallery assets with custom order
  await testLink('event', event.id, 'gallery', 2, assetGal1.id); // gal1 order = 2
  await request<any>('/media/link', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { mediaAssetId: assetGal2.id, entityType: 'event', entityId: event.id, role: 'gallery', displayOrder: 1 } // gal2 order = 1
  });

  // Query entity gallery and assert correct order
  console.log('Verifying sorted entity gallery...');
  const galleryQuery = await request<any[]>(`/media/gallery/event/${event.id}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const gallery = extractSuccess(galleryQuery, 'get event gallery');
  assert(gallery.length === 2, 'Expected 2 gallery items');
  // First item must be gallery asset 2 (displayOrder = 1)
  assert(gallery[0].id === assetGal2.id, 'Order check failed: first item should be gal2');
  assert(gallery[1].id === assetGal1.id, 'Order check failed: second item should be gal1');

  // Query all media for entity
  console.log('Querying all media linked to Event...');
  const entityMediaQuery = await request<any[]>(`/media/entity/event/${event.id}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const allEventMedia = extractSuccess(entityMediaQuery, 'get all event media');
  // Should contain 1 hero link + 2 gallery links = 3 items total
  assert(allEventMedia.length === 3, 'Expected 3 items linked to event');

  // 8. Video upload check
  console.log('Testing video upload completion...');
  const uploadVid = await request<any>('/media/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { fileName: 'promo.mp4', mimeType: 'video/mp4', fileSize: 5 * 1024 * 1024, entityType: 'event', role: 'promo_video' }
  });
  const infoVid = extractSuccess(uploadVid, 'upload url video');
  const compVid = await request<any>('/media/complete', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { storageKey: infoVid.storageKey, fileName: 'promo.mp4', mimeType: 'video/mp4', fileSize: 5 * 1024 * 1024 }
  });
  const assetVid = extractSuccess(compVid, 'complete video');
  assert(assetVid.mimeType === 'video/mp4', 'MimeType should be video/mp4');

  // 9. Media Unlinking
  console.log('Testing Media Unlinking...');
  const unlinkRes = await request<any>('/media/link', {
    method: 'DELETE',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: {
      mediaAssetId: asset1.id,
      entityType: 'event',
      entityId: event.id,
      role: 'hero'
    }
  });
  extractSuccess(unlinkRes, 'unlink media from event');

  // Verify link is gone
  const afterUnlinkQuery = await request<any[]>(`/media/entity/event/${event.id}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  const afterUnlinkMedia = extractSuccess(afterUnlinkQuery, 'get event media post unlink');
  assert(!afterUnlinkMedia.some((m) => m.role === 'hero'), 'Hero link should be removed');

  // 10. Tenant Isolation
  console.log('Testing Multi-Tenant Isolation...');
  // Outsider user requests media asset of Tenant A
  const getOutsiderAsset = await request(`/media/${asset1.id}`, {
    headers: authHeaders(outsider.tokens.accessToken, tenantA.slug) // requesting Tenant A context with Tenant B token
  });
  expectStatus(getOutsiderAsset, [403, 404], 'Block outsider from reading Tenant A assets');

  // Outsider tries to link Tenant A asset
  const outsiderLink = await request('/media/link', {
    method: 'POST',
    headers: authHeaders(outsider.tokens.accessToken, tenantA.slug),
    body: { mediaAssetId: asset1.id, entityType: 'event', entityId: event.id, role: 'hero' }
  });
  expectStatus(outsiderLink, [403], 'Block outsider from linking Tenant A asset');

  // 11. RBAC permissions
  console.log('Testing RBAC security limits...');
  // Viewer (non-uploader, non-manager role) tries to delete asset1
  const deleteViewer = await request(`/media/${asset1.id}`, {
    method: 'DELETE',
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: asset1.updatedAt }
  });
  expectStatus(deleteViewer, [403], 'Deny viewer deletion permissions');

  // 12. Optimistic Concurrency Control (OCC)
  console.log('Testing OCC concurrency locking...');
  // Delete asset1 with a stale timestamp
  const staleDate = new Date(Date.now() - 3600000).toISOString();
  const deleteStale = await request(`/media/${asset1.id}`, {
    method: 'DELETE',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: staleDate }
  });
  expectStatus(deleteStale, [409], 'Block delete request with stale OCC timestamp');

  // 13. Soft Deletes
  console.log('Testing soft deletes...');
  const deleteOk = await request(`/media/${asset1.id}`, {
    method: 'DELETE',
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: asset1.updatedAt }
  });
  extractSuccess(deleteOk, 'soft delete media asset');

  // Fetching deleted asset should return 404
  const getDeleted = await request(`/media/${asset1.id}`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantA.slug)
  });
  expectStatus(getDeleted, [404], 'Soft deleted asset must return 404 Not Found');

  // 14. Activity Logging validation
  console.log('Verifying activity log entries...');
  const logs = await db
    .select()
    .from(profileActivity)
    .where(eq(profileActivity.profileId, ownerProf.id))
    .orderBy(desc(profileActivity.createdAt));

  assert(logs.some((l) => l.activityType === 'media_uploaded'), 'Uploaded activity log missing');
  assert(logs.some((l) => l.activityType === 'media_linked'), 'Linked activity log missing');
  assert(logs.some((l) => l.activityType === 'media_unlinked'), 'Unlinked activity log missing');
  assert(logs.some((l) => l.activityType === 'media_deleted'), 'Deleted activity log missing');

  // 15. Media Analytics dashboard
  console.log('Verifying Media Analytics metrics...');
  const analyticsRes = await request<any>('/media/analytics', {
    headers: authHeaders(owner.tokens.accessToken, tenantA.slug)
  });
  const stats = extractSuccess(analyticsRes, 'get media analytics');
  assert(stats.totalUploads >= 2, 'Expected at least 2 uploads registered');
  assert(stats.totalStorageBytes > 0, 'Expected positive storage footprint footprint');
  assert(stats.uploadsByEntity.length > 0, 'Expected entity distribution entries');
  assert(stats.topUploaders.some((u: any) => u.username === owner.user.username), 'Expected owner in top uploaders list');
  assert(stats.mediaGrowth.length > 0, 'Expected media growth history entries');
  assert(stats.mediaTypeDistribution.length > 0, 'Expected mime-type distribution entries');

  // Clean up database tables
  console.log('Cleaning up mock database entities...');
  await db.transaction(async (tx) => {
    // Delete links and assets
    await tx.delete(mediaLinks).where(eq(mediaLinks.tenantId, tenantA.id));
    await tx.delete(mediaAssets).where(eq(mediaAssets.tenantId, tenantA.id));

    // Delete verification, reviews, and safety alerts
    await tx.delete(organizerVerifications).where(eq(organizerVerifications.tenantId, tenantA.id));
    await tx.delete(organizerReviews).where(eq(organizerReviews.id, review.id));
    await tx.delete(sosAlerts).where(eq(sosAlerts.tenantId, tenantA.id));

    // Delete ticket types, campaigns, group bookings, and stories
    await tx.delete(ticketTypes).where(eq(ticketTypes.tenantId, tenantA.id));
    await tx.delete(marketingCampaigns).where(eq(marketingCampaigns.tenantId, tenantA.id));
    await tx.delete(groupBookings).where(eq(groupBookings.tenantId, tenantA.id));
    await tx.delete(bookingOrders).where(eq(bookingOrders.tenantId, tenantA.id));
    await tx.delete(stories).where(eq(stories.tenantId, tenantA.id));

    // Delete events, artists, venues, and profiles
    await tx.delete(events).where(eq(events.tenantId, tenantA.id));
    await tx.delete(artists).where(eq(artists.tenantId, tenantA.id));
    await tx.delete(venues).where(eq(venues.tenantId, tenantA.id));

    // Delete activities and profile
    await tx.delete(profileActivity).where(eq(profileActivity.tenantId, tenantA.id));
    await tx.delete(profiles).where(eq(profiles.tenantId, tenantA.id));

    // Tenant B cleanup
    await tx.delete(profiles).where(eq(profiles.tenantId, tenantB.id));
  });

  console.log('\nMEDIA PLATFORM SMOKE TEST PASSED\n');
  process.exit(0);
}

run().catch((error) => {
  console.error('\nMEDIA PLATFORM SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
