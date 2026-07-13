import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookingOrders } from '../db/schema/booking-orders.js';
import { issuedTicketEvents } from '../db/schema/issued-ticket-events.js';
import { marketingCampaigns } from '../db/schema/marketing-campaigns.js';
import { marketingCampaignDeliveries } from '../db/schema/marketing-campaign-deliveries.js';
import { marketingSubscribers } from '../db/schema/marketing-subscribers.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

interface ApiError {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface RequestResult<T> {
  status: number;
  ok: boolean;
  data: T | ApiError | null;
  meta?: PaginationMeta;
  raw: string;
}

interface AuthResult {
  user: { id: string; username: string; email: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface TenantRecord { id: string; slug: string; name: string; }
interface VenueRecord { id: string; }
interface EventRecord { id: string; slug: string; }
interface BookingOrderRecord { id: string; orderNumber: string; status: string; updatedAt: string; }
interface BookingOrderItemRecord { id: string; quantity: number; ticketTypeId: string; }
interface BookingAttendeeRecord { attendeeId: string; attendeeEmail: string; bookingOrderItemId: string; }
interface IssuedTicketRecord {
  id: string;
  ticketNumber: string;
  qrCodeToken: string;
  status: 'issued' | 'checked_in' | 'cancelled' | 'transferred' | 'refunded' | 'invalidated';
  updatedAt: string;
}

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
  let meta: PaginationMeta | undefined;

  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { data?: T; meta?: PaginationMeta } & ApiError;
      data = parsed as unknown as T | ApiError;
      meta = parsed.meta;
    } catch {
      data = null;
    }
  }

  if (VERBOSE) {
    console.log(`${response.status} ${options.method ?? 'GET'} ${path}`);
    if (raw.trim()) console.log(raw);
  }

  return { status: response.status, ok: response.ok, data, meta, raw };
}

function extractSuccess<T>(result: RequestResult<ApiSuccess<T>>, label: string) {
  assert(result.ok, `${label} failed`, result.data ?? result.raw);
  const payload = result.data as ApiSuccess<T> | null;
  assert(payload?.success === true, `${label} returned invalid payload`, result.data ?? result.raw);
  return payload.data;
}

function expectStatus(result: RequestResult<unknown>, statuses: number[], label: string) {
  assert(statuses.includes(result.status), `${label} expected ${statuses.join(', ')} but got ${result.status}`, result.data ?? result.raw);
}

async function signup(prefix: string, displayName: string) {
  const stamp = Date.now();
  const phoneSuffix = String(stamp).slice(-4).padStart(4, '0');
  const body = {
    fullName: displayName,
    username: `${prefix}_${stamp}`,
    email: `${prefix}_${stamp}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+1415555${phoneSuffix}`
  };

  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body
  });
  const startResult = extractSuccess(startResponse, `${displayName} signup start`);

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId: startResult.verificationSessionId,
      code: '123456'
    }
  });
  return extractSuccess(verifyResponse, `${displayName} signup verify`);
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', { method: 'POST', headers: authHeaders(accessToken), body: { name, description: `${name} tenant` } });
  return extractSuccess(response, `create tenant ${name}`);
}

async function createVenue(accessToken: string, tenantSlug: string, suffix: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: { name: `Venue dome ${suffix}`, addressLine1: 'SG Highway', city: 'Ahmedabad', state: 'Gujarat', country: 'India', capacity: 100 }
  });
  return extractSuccess(response, 'create venue');
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
      shortDescription: 'Festival load test event.',
      description: 'Massive festival.',
      startDateTime,
      endDateTime,
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId,
      isFeatured: true
    }
  });
  return extractSuccess(response, 'create event');
}

async function createTicketType(accessToken: string, tenantSlug: string, eventId: string, payload: Record<string, unknown>) {
  const response = await request<ApiSuccess<{ id: string; slug: string }>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      eventId,
      status: 'active',
      visibility: 'public',
      currency: 'INR',
      taxBehavior: 'exclusive',
      soldQuantity: 0,
      reservedQuantity: 0,
      minPerOrder: 1,
      maxPerOrder: 10,
      ...payload
    }
  });
  return extractSuccess(response, 'create ticket type');
}

async function run() {
  console.log('TENANT DASHBOARD & ANALYTICS SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  // 1. Setup Identities & Tenant Workspace
  const owner = await signup('tenant_owner', 'Tenant Owner');
  const manager = await signup('tenant_manager', 'Tenant Manager');
  const staff = await signup('tenant_staff', 'Tenant Staff');
  const viewer = await signup('tenant_viewer', 'Tenant Viewer');
  const outsider = await signup('tenant_outsider', 'Tenant Outsider');

  // Create two isolated tenants
  const tenantAhmedabad = await createTenant(owner.tokens.accessToken, 'Ahmedabad Tenant Ops');
  const tenantSurat = await createTenant(outsider.tokens.accessToken, 'Surat Tenant Ops');

  // Add members to Ahmedabad Tenant Ops
  const addManager = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantAhmedabad.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: manager.user.id, role: 'manager' }
  });
  extractSuccess(addManager, 'add manager');

  const addStaff = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantAhmedabad.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: staff.user.id, role: 'staff' }
  });
  extractSuccess(addStaff, 'add staff');

  const addViewer = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantAhmedabad.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: viewer.user.id, role: 'viewer' }
  });
  extractSuccess(addViewer, 'add viewer');

  // 2. Setup Venues & Multiple Events (completed, live, upcoming)
  const venueA = await createVenue(owner.tokens.accessToken, tenantAhmedabad.slug, 'A');
  const venueB = await createVenue(owner.tokens.accessToken, tenantAhmedabad.slug, 'B');

  const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const liveStart = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const liveEnd = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();

  const upcomingStart = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const upcomingEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  const eventPast = await createEvent(owner.tokens.accessToken, tenantAhmedabad.slug, venueA.id, 'Past Garba Concert', pastStart, pastEnd);
  const eventLive = await createEvent(owner.tokens.accessToken, tenantAhmedabad.slug, venueA.id, 'Live Garba Festival', liveStart, liveEnd);
  const eventUpcoming = await createEvent(owner.tokens.accessToken, tenantAhmedabad.slug, venueB.id, 'Upcoming Garba Night', upcomingStart, upcomingEnd);

  // 3. Create Ticket Types for Events
  const pastTicket = await createTicketType(owner.tokens.accessToken, tenantAhmedabad.slug, eventPast.id, {
    name: 'Standard Pass', price: 100, totalQuantity: 50, slug: 'past-std'
  });
  const liveVipTicket = await createTicketType(owner.tokens.accessToken, tenantAhmedabad.slug, eventLive.id, {
    name: 'VIP Pass', price: 200, totalQuantity: 10, slug: 'live-vip'
  });
  const liveGaTicket = await createTicketType(owner.tokens.accessToken, tenantAhmedabad.slug, eventLive.id, {
    name: 'General Pass', price: 50, totalQuantity: 90, slug: 'live-ga'
  });
  const upcomingTicket = await createTicketType(owner.tokens.accessToken, tenantAhmedabad.slug, eventUpcoming.id, {
    name: 'Early Bird Pass', price: 80, totalQuantity: 100, slug: 'up-eb'
  });

  // 4. Sales & Bookings
  // Booking 1: Event Live (1 VIP, 2 General) -> Confirmed
  const createBooking1 = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug),
    body: {
      eventId: eventLive.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [
        { ticketTypeId: liveVipTicket.id, quantity: 1 },
        { ticketTypeId: liveGaTicket.id, quantity: 2 }
      ]
    }
  });
  const booking1 = extractSuccess(createBooking1, 'create booking 1');

  // Assign Attendees
  const booking1ItemsRes = await request<ApiSuccess<BookingOrderItemRecord[]>>(`/booking-orders/${booking1.orderNumber}/items`, {
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug)
  });
  const booking1Items = extractSuccess(booking1ItemsRes, 'get booking 1 items');

  const assignBooking1 = await request<ApiSuccess<BookingAttendeeRecord[]>>(`/booking-orders/${booking1.orderNumber}/assign-attendees`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug),
    body: {
      assignments: [
        { bookingOrderItemId: booking1Items[0].id, attendee: { fullName: 'Attendee A1', email: 'a1@example.com', phone: '+919999000011', city: 'Ahmedabad', status: 'confirmed' } },
        { bookingOrderItemId: booking1Items[1].id, attendee: { fullName: 'Attendee A2', email: 'a2@example.com', phone: '+919999000012', city: 'Ahmedabad', status: 'confirmed' } }
      ]
    }
  });
  extractSuccess(assignBooking1, 'assign attendees booking 1');

  const confirmBooking1 = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking1.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug),
    body: { status: 'confirmed', notes: 'Paid and Confirmed', lastKnownUpdatedAt: booking1.updatedAt }
  });
  const confirmedBooking1 = extractSuccess(confirmBooking1, 'confirm booking 1');

  // Booking 2: Event Upcoming (1 Early Bird) -> Pending
  const createBooking2 = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug),
    body: {
      eventId: eventUpcoming.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: upcomingTicket.id, quantity: 1 }]
    }
  });
  extractSuccess(createBooking2, 'create booking 2 (pending)');

  // Booking 3: Event Past (1 Standard) -> Confirmed
  const createBooking3 = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug),
    body: {
      eventId: eventPast.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: pastTicket.id, quantity: 1 }]
    }
  });
  const booking3 = extractSuccess(createBooking3, 'create booking 3');

  const confirmBooking3 = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking3.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug),
    body: { status: 'confirmed', notes: 'Completed Past', lastKnownUpdatedAt: booking3.updatedAt }
  });
  extractSuccess(confirmBooking3, 'confirm booking 3');

  // 5. Gate scans & Check-in simulation
  const listLiveTickets = await request<ApiSuccess<IssuedTicketRecord[]>>(`/issued-tickets?bookingOrderId=${confirmedBooking1.id}`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const liveTickets = extractSuccess(listLiveTickets, 'list live tickets');
  const ticketToCheckIn = liveTickets[0];

  // Scan 1: Validate (valid scan)
  const validateScan1 = await request<ApiSuccess<{ valid: boolean; status: string; ticket: IssuedTicketRecord | null }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug),
    body: { qrCodeToken: ticketToCheckIn.qrCodeToken }
  });
  const scan1Result = extractSuccess(validateScan1, 'validate Scan 1');

  // Scan 2: Check-in
  const checkinRes = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${ticketToCheckIn.ticketNumber}/check-in`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug),
    body: { lastKnownUpdatedAt: (scan1Result.ticket ?? ticketToCheckIn).updatedAt }
  });
  extractSuccess(checkinRes, 'check-in ticket');

  // Scan 3: Duplicate Scan rejection (Outcome: already_checked_in)
  await request<ApiSuccess<any>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug),
    body: { qrCodeToken: ticketToCheckIn.qrCodeToken }
  });

  // 6. Email marketing campaign & subscribers
  const subscriberEmail = `sub_tenant_${Date.now()}@example.com`;
  const subscribeRes = await request<ApiSuccess<any>>('/marketing/subscribers', {
    method: 'POST',
    headers: { 'x-tenant-slug': tenantAhmedabad.slug },
    body: { email: subscriberEmail, firstName: 'Tenant', lastName: 'Subscriber', source: 'tenant_dashboard_test' }
  });
  extractSuccess(subscribeRes, 'add marketing subscriber');

  // Create and send Campaign
  const createCampaign = await request<ApiSuccess<any>>('/marketing-campaigns', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug),
    body: { name: 'Tenant News', subject: 'Platform updates', templateType: 'newsletter' }
  });
  const campaign = extractSuccess(createCampaign, 'create campaign');

  await request<ApiSuccess<any>>(`/marketing-campaigns/${campaign.id}/send`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenantAhmedabad.slug)
  });

  // 7. Verify GET /tenants/:slug/dashboard
  console.log('Testing GET /tenants/:slug/dashboard...');
  const getDashboard = await request<ApiSuccess<any>>(`/tenants/${tenantAhmedabad.slug}/dashboard`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const dashboard = extractSuccess(getDashboard, 'retrieve dashboard');

  assert(dashboard.tenantId === tenantAhmedabad.id, 'Tenant ID mismatch');
  assert(dashboard.tenantName === tenantAhmedabad.name, 'Tenant Name mismatch');
  assert(dashboard.totalEvents === 3, `Expected 3 totalEvents, got ${dashboard.totalEvents}`);
  assert(dashboard.publishedEvents === 3, `Expected 3 publishedEvents, got ${dashboard.publishedEvents}`);
  assert(dashboard.upcomingEvents === 1, `Expected 1 upcomingEvents, got ${dashboard.upcomingEvents}`);
  assert(dashboard.completedEvents === 1, `Expected 1 completedEvents, got ${dashboard.completedEvents}`);
  assert(dashboard.ticketsSold === 4, `Expected 4 ticketsSold (3 from live, 1 from past), got ${dashboard.ticketsSold}`);
  assert(dashboard.totalBookings === 3, `Expected 3 totalBookings, got ${dashboard.totalBookings}`);
  assert(dashboard.confirmedBookings === 2, `Expected 2 confirmedBookings, got ${dashboard.confirmedBookings}`);
  assert(dashboard.cancelledBookings === 0, `Expected 0 cancelledBookings, got ${dashboard.cancelledBookings}`);
  assert(dashboard.attendeesRegistered === 2, `Expected 2 attendeesRegistered, got ${dashboard.attendeesRegistered}`);
  assert(dashboard.attendeesCheckedIn === 1, `Expected 1 attendeesCheckedIn, got ${dashboard.attendeesCheckedIn}`);
  // grossRevenue: Booking 1 (1 VIP = 200 + 2 Gen = 100 => 300) + Booking 3 (1 Standard = 100) = 400 => 40000 cents
  assert(dashboard.grossRevenue === 40000, `Expected 40000 grossRevenue, got ${dashboard.grossRevenue}`);
  assert(['healthy', 'warning', 'critical'].includes(dashboard.healthScore), `Invalid health score: ${dashboard.healthScore}`);

  // 8. Verify GET /tenants/:slug/analytics
  console.log('Testing GET /tenants/:slug/analytics...');
  const getAnalytics = await request<ApiSuccess<any>>(`/tenants/${tenantAhmedabad.slug}/analytics`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const analytics = extractSuccess(getAnalytics, 'retrieve analytics');

  assert(Array.isArray(analytics.sales.daily), 'sales.daily should be an array');
  assert(Array.isArray(analytics.revenue.daily), 'revenue.daily should be an array');
  assert(analytics.bookings.total === 3, `Expected 3 total bookings in analytics, got ${analytics.bookings.total}`);
  assert(analytics.bookings.confirmed === 2, `Expected 2 confirmed bookings in analytics, got ${analytics.bookings.confirmed}`);
  assert(analytics.bookings.conversionRate === 66.7, `Expected 66.7 conversionRate, got ${analytics.bookings.conversionRate}`);
  assert(analytics.attendee.assignmentRate === 50.0, `Expected 50.0 assignmentRate (2 assigned / 4 sold), got ${analytics.attendee.assignmentRate}`);
  assert(analytics.checkIn.attendancePercentage === 50.0, `Expected 50.0 attendancePercentage (1 checked in / 2 registered), got ${analytics.checkIn.attendancePercentage}`);
  assert(analytics.marketing.campaignsCount === 1, `Expected 1 campaignsCount, got ${analytics.marketing.campaignsCount}`);
  assert(analytics.marketing.emailSends >= 1, `Expected >= 1 emailSends, got ${analytics.marketing.emailSends}`);

  // 9. Verify GET /tenants/:slug/top-events
  console.log('Testing GET /tenants/:slug/top-events...');
  const getTopEvents = await request<ApiSuccess<any[]>>(`/tenants/${tenantAhmedabad.slug}/top-events?sortBy=ticketsSold&sortOrder=desc&limit=10`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const topEvents = extractSuccess(getTopEvents, 'retrieve top events');
  assert(topEvents.length >= 2, 'Should return at least 2 events');
  // First event should be Live Garba Festival (3 tickets sold) vs Past Garba Concert (1 ticket sold)
  assert(topEvents[0].eventName === 'Live Garba Festival', `Expected first top event to be Live Garba Festival, got ${topEvents[0].eventName}`);
  assert(topEvents[0].ticketsSold === 3, `Expected 3 sold, got ${topEvents[0].ticketsSold}`);

  // Test sorting by revenue
  const getTopEventsRevenue = await request<ApiSuccess<any[]>>(`/tenants/${tenantAhmedabad.slug}/top-events?sortBy=revenue&sortOrder=desc&limit=10`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const topEventsRevenue = extractSuccess(getTopEventsRevenue, 'retrieve top events sorted by revenue');
  assert(topEventsRevenue[0].eventName === 'Live Garba Festival', 'Live Garba Festival should be top revenue');

  // 10. Verify GET /tenants/:slug/upcoming-events
  console.log('Testing GET /tenants/:slug/upcoming-events...');
  const getUpcomingEvents = await request<ApiSuccess<any[]>>(`/tenants/${tenantAhmedabad.slug}/upcoming-events`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const upcomingEvents = extractSuccess(getUpcomingEvents, 'retrieve upcoming events');
  assert(upcomingEvents.length === 1, `Expected exactly 1 upcoming event, got ${upcomingEvents.length}`);
  assert(upcomingEvents[0].eventName === 'Upcoming Garba Night', `Expected Upcoming Garba Night, got ${upcomingEvents[0].eventName}`);
  assert(upcomingEvents[0].ticketsSold === 0, `Expected 0 tickets sold, got ${upcomingEvents[0].ticketsSold}`);
  assert(upcomingEvents[0].utilizationPercentage === 0.0, `Expected 0.0 utilization, got ${upcomingEvents[0].utilizationPercentage}`);

  // 11. Verify GET /tenants/:slug/activity
  console.log('Testing GET /tenants/:slug/activity...');
  const getActivity = await request<ApiSuccess<any[]>>(`/tenants/${tenantAhmedabad.slug}/activity?limit=10`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const activity = extractSuccess(getActivity, 'retrieve activity feed');
  assert(activity.length >= 4, `Expected at least 4 activity feed entries, got ${activity.length}`);

  const activityTypes = activity.map((a) => a.activityType);
  assert(activityTypes.includes('event_published'), 'Feed should include event_published');
  assert(activityTypes.includes('booking_confirmed'), 'Feed should include booking_confirmed');
  assert(activityTypes.includes('ticket_issued'), 'Feed should include ticket_issued');
  assert(activityTypes.includes('ticket_checked_in'), 'Feed should include ticket_checked_in');
  assert(activityTypes.includes('campaign_sent'), 'Feed should include campaign_sent');
  assert(activityTypes.includes('subscriber_added'), 'Feed should include subscriber_added');

  // Test pagination filter
  const lastActivity = activity[2];
  const paginatedActivityRes = await request<ApiSuccess<any[]>>(`/tenants/${tenantAhmedabad.slug}/activity?limit=2&cursor=${lastActivity.createdAt}`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const paginatedActivity = extractSuccess(paginatedActivityRes, 'retrieve paginated activity');
  assert(paginatedActivity.length <= 2, 'Activity cursor limit failed');

  // 12. Verify GET /tenants/:slug/health
  console.log('Testing GET /tenants/:slug/health...');
  const getHealth = await request<ApiSuccess<any>>(`/tenants/${tenantAhmedabad.slug}/health`, {
    headers: authHeaders(manager.tokens.accessToken, tenantAhmedabad.slug)
  });
  const healthStatus = extractSuccess(getHealth, 'retrieve health status');
  assert(['healthy', 'warning', 'critical'].includes(healthStatus.status), `Invalid health status: ${healthStatus.status}`);

  // 13. Security checks: tenant isolation and RBAC checks
  console.log('Running security checks...');
  
  // Outsider cannot access Ahmedabad Tenant dashboard
  const outsiderDashboard = await request(`/tenants/${tenantAhmedabad.slug}/dashboard`, {
    headers: authHeaders(outsider.tokens.accessToken, tenantAhmedabad.slug)
  });
  expectStatus(outsiderDashboard, [403, 404], 'Outsider should be denied access');

  // Viewer cannot access dashboard (RBAC restriction)
  const viewerDashboard = await request(`/tenants/${tenantAhmedabad.slug}/dashboard`, {
    headers: authHeaders(viewer.tokens.accessToken, tenantAhmedabad.slug)
  });
  expectStatus(viewerDashboard, [403], 'Viewer should be denied access');

  // Staff and Manager can access dashboard
  const staffDashboard = await request<ApiSuccess<any>>(`/tenants/${tenantAhmedabad.slug}/dashboard`, {
    headers: authHeaders(staff.tokens.accessToken, tenantAhmedabad.slug)
  });
  expectStatus(staffDashboard, [200], 'Staff should be allowed access');

  // 14. Cleanup
  console.log('Cleaning up...');
  await db.transaction(async (tx) => {
    // Delete campaign deliveries
    await tx.delete(marketingCampaignDeliveries).where(eq(marketingCampaignDeliveries.campaignId, campaign.id));
    // Delete marketing campaigns
    await tx.delete(marketingCampaigns).where(eq(marketingCampaigns.id, campaign.id));
    // Delete marketing subscribers
    await tx.delete(marketingSubscribers).where(eq(marketingSubscribers.email, subscriberEmail));
  });

  console.log('TENANT DASHBOARD & ANALYTICS SMOKE TEST PASSED!');
}

run().catch((error) => {
  console.error('\nTENANT DASHBOARD & ANALYTICS SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
