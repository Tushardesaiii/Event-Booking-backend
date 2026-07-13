import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookingOrders } from '../db/schema/booking-orders.js';
import { issuedTicketEvents } from '../db/schema/issued-ticket-events.js';

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

interface TenantRecord { id: string; slug: string; }
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
    body: { name: `Navratri Dome ${suffix}`, addressLine1: 'SG Highway', city: 'Ahmedabad', state: 'Gujarat', country: 'India', capacity: 100 }
  });
  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string, suffix: string) {
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      title: `Royal Navratri Concert ${suffix}`,
      shortDescription: 'Massive Ahmedabad Garba festival',
      description: 'Navratri-scale load test event.',
      startDateTime: '2026-10-16T14:00:00.000Z',
      endDateTime: '2026-10-17T05:30:00.000Z',
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
  console.log('EVENT DASHBOARD & ANALYTICS SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  // 1. Setup Identities & Tenant Workspace
  const owner = await signup('analytics_owner', 'Analytics Owner');
  const manager = await signup('analytics_manager', 'Analytics Manager');
  const outsider = await signup('analytics_outsider', 'Analytics Outsider');

  const tenant = await createTenant(owner.tokens.accessToken, 'Ahmedabad Analytics Ops');
  const outsiderTenant = await createTenant(outsider.tokens.accessToken, 'Surat Analytics Ops');

  const addManager = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: manager.user.id, role: 'manager' }
  });
  extractSuccess(addManager, 'add manager');

  // 2. Setup Event Infrastructure
  const venue = await createVenue(owner.tokens.accessToken, tenant.slug, 'A');
  const event = await createEvent(owner.tokens.accessToken, tenant.slug, venue.id, '2026');

  // VIP capacity = 2
  const vipTicket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id, {
    name: 'VIP Garba Pass',
    price: 200,
    totalQuantity: 2,
    slug: 'vip-garba-pass'
  });

  // General Admission capacity = 98
  const generalTicket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id, {
    name: 'General Garba Pass',
    price: 50,
    totalQuantity: 98,
    slug: 'general-garba-pass'
  });

  // 3. Sales Phase: Creating Bookings
  // Booking 1: 1 VIP Ticket (Pending -> Confirmed)
  const createBooking1 = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: vipTicket.id, quantity: 1 }]
    }
  });
  const booking1 = extractSuccess(createBooking1, 'create booking 1');

  // Assign Attendee A to Booking 1
  const booking1ItemsRes = await request<ApiSuccess<BookingOrderItemRecord[]>>(`/booking-orders/${booking1.orderNumber}/items`, {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const booking1Items = extractSuccess(booking1ItemsRes, 'get booking 1 items');

  const assignBooking1 = await request<ApiSuccess<BookingAttendeeRecord[]>>(`/booking-orders/${booking1.orderNumber}/assign-attendees`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      assignments: [{
        bookingOrderItemId: booking1Items[0].id,
        attendee: { fullName: 'Attendee A', email: 'attendee.a@example.com', phone: '+919999000001', city: 'Ahmedabad', status: 'confirmed' }
      }]
    }
  });
  extractSuccess(assignBooking1, 'assign attendee A');

  // Confirm Booking 1
  const confirmBooking1 = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking1.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: { status: 'confirmed', notes: 'Confirmed', lastKnownUpdatedAt: booking1.updatedAt }
  });
  const confirmedBooking1 = extractSuccess(confirmBooking1, 'confirm booking 1');

  // Booking 2: 2 GA Tickets (Pending -> Confirmed)
  const createBooking2 = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: generalTicket.id, quantity: 2 }]
    }
  });
  const booking2 = extractSuccess(createBooking2, 'create booking 2');

  // Assign Attendee B to one GA ticket, leave the other unassigned
  const booking2ItemsRes = await request<ApiSuccess<BookingOrderItemRecord[]>>(`/booking-orders/${booking2.orderNumber}/items`, {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const booking2Items = extractSuccess(booking2ItemsRes, 'get booking 2 items');

  const assignBooking2 = await request<ApiSuccess<BookingAttendeeRecord[]>>(`/booking-orders/${booking2.orderNumber}/assign-attendees`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      assignments: [{
        bookingOrderItemId: booking2Items[0].id,
        attendee: { fullName: 'Attendee B', email: 'attendee.b@example.com', phone: '+919999000002', city: 'Ahmedabad', status: 'confirmed' }
      }]
    }
  });
  extractSuccess(assignBooking2, 'assign attendee B');

  // Confirm Booking 2
  const confirmBooking2 = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking2.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: { status: 'confirmed', notes: 'Confirmed', lastKnownUpdatedAt: booking2.updatedAt }
  });
  const confirmedBooking2 = extractSuccess(confirmBooking2, 'confirm booking 2');

  // Booking 3: 1 GA Ticket (Pending - stays pending to test reservations)
  const createBooking3 = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: generalTicket.id, quantity: 1 }]
    }
  });
  extractSuccess(createBooking3, 'create booking 3 (pending)');

  // Booking 4: 1 GA Ticket (Pending -> Cancelled to test cancellation/release)
  const createBooking4 = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: generalTicket.id, quantity: 1 }]
    }
  });
  const booking4 = extractSuccess(createBooking4, 'create booking 4');

  const cancelBooking4 = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking4.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: { status: 'cancelled', cancellationReason: 'Cancelled by customer', lastKnownUpdatedAt: booking4.updatedAt }
  });
  extractSuccess(cancelBooking4, 'cancel booking 4');

  // 4. Retrieve Issued Tickets for scan checks
  const listVipTickets = await request<ApiSuccess<IssuedTicketRecord[]>>(`/issued-tickets?bookingOrderId=${confirmedBooking1.id}`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const vipTickets = extractSuccess(listVipTickets, 'list VIP tickets');
  assert(vipTickets.length === 1, 'Should have exactly 1 issued VIP ticket');
  const vipTicketRecord = vipTickets[0];

  // 5. Gate Scan Operations Phase
  console.log('Simulating gate scans...');

  // Scan 1: Valid scan on VIP ticket (Outcome: valid)
  const scan1 = await request<ApiSuccess<{ valid: boolean; status: string; ticket: IssuedTicketRecord | null }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { qrCodeToken: vipTicketRecord.qrCodeToken }
  });
  const scan1Result = extractSuccess(scan1, 'validate VIP ticket');
  assert(scan1Result.valid === true && scan1Result.status === 'valid', 'Scan 1 should be valid');

  // Scan 2: Perform Gate Check-In (Outcome: checked_in)
  const checkin1 = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${vipTicketRecord.ticketNumber}/check-in`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { lastKnownUpdatedAt: (scan1Result.ticket ?? vipTicketRecord).updatedAt }
  });
  const checkin1Result = extractSuccess(checkin1, 'check in VIP ticket');
  assert(checkin1Result.status === 'checked_in', 'Ticket should be checked in');

  // Scan 3: Re-scan (validate) checked in ticket (Outcome: already_checked_in - duplicate scan failure)
  const scan3 = await request<ApiSuccess<{ valid: boolean; status: string }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { qrCodeToken: vipTicketRecord.qrCodeToken }
  });
  const scan3Result = extractSuccess(scan3, 'validate checked-in VIP ticket (duplicate scan)');
  assert(scan3Result.valid === false && scan3Result.status === 'already_checked_in', 'Duplicate scan should be rejected as already checked in');

  // Scan 4: Scan invalid/fake QR Code (Outcome: invalid_qr - validation rejection failure)
  const scan4 = await request<ApiSuccess<{ valid: boolean; status: string }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { qrCodeToken: 'fake-qr-code-token-invalid-123456789' }
  });
  const scan4Result = extractSuccess(scan4, 'validate fake QR code');
  assert(scan4Result.valid === false && scan4Result.status === 'invalid_qr', 'Fake QR validation should be rejected');

  // 6. Test Endpoint 1: GET /events/:slug/dashboard
  console.log('Testing GET /events/:slug/dashboard...');
  const getDashboard = await request<ApiSuccess<any>>(`/events/${event.slug}/dashboard`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const dashboard = extractSuccess(getDashboard, 'retrieve dashboard');

  assert(dashboard.ticketsSold === 3, `Expected ticketsSold = 3, got ${dashboard.ticketsSold}`);
  assert(dashboard.ticketsAvailable === 96, `Expected ticketsAvailable = 96, got ${dashboard.ticketsAvailable}`);
  assert(dashboard.ticketsReserved === 1, `Expected ticketsReserved = 1, got ${dashboard.ticketsReserved}`);
  assert(dashboard.bookingsTotal === 4, `Expected bookingsTotal = 4, got ${dashboard.bookingsTotal}`);
  assert(dashboard.bookingsPending === 1, `Expected bookingsPending = 1, got ${dashboard.bookingsPending}`);
  assert(dashboard.bookingsConfirmed === 2, `Expected bookingsConfirmed = 2, got ${dashboard.bookingsConfirmed}`);
  assert(dashboard.bookingsCancelled === 1, `Expected bookingsCancelled = 1, got ${dashboard.bookingsCancelled}`);
  assert(dashboard.attendeesRegistered === 2, `Expected attendeesRegistered = 2, got ${dashboard.attendeesRegistered}`);
  assert(dashboard.ticketsCheckedIn === 1, `Expected ticketsCheckedIn = 1, got ${dashboard.ticketsCheckedIn}`);
  assert(dashboard.ticketsNotCheckedIn === 2, `Expected ticketsNotCheckedIn = 2, got ${dashboard.ticketsNotCheckedIn}`);
  assert(dashboard.checkInRate === 33.3, `Expected checkInRate = 33.3, got ${dashboard.checkInRate}`);
  // grossRevenue: Booking 1 (200.00) + Booking 2 (100.00) = 300.00 -> 30000 cents
  assert(dashboard.grossRevenue === 30000, `Expected grossRevenue = 30000, got ${dashboard.grossRevenue}`);
  // estimatedRevenue: Booking 1 (200.00) + Booking 2 (100.00) + Booking 3 (50.00) = 350.00 -> 35000 cents
  assert(dashboard.estimatedRevenue === 35000, `Expected estimatedRevenue = 35000, got ${dashboard.estimatedRevenue}`);
  assert(dashboard.healthScore >= 0 && dashboard.healthScore <= 100, `Invalid health score: ${dashboard.healthScore}`);
  assert(['Healthy', 'Warning', 'Critical'].includes(dashboard.healthStatus), `Invalid health status: ${dashboard.healthStatus}`);

  // 7. Test Endpoint 2: GET /events/:slug/analytics
  console.log('Testing GET /events/:slug/analytics...');
  const getAnalytics = await request<ApiSuccess<any>>(`/events/${event.slug}/analytics`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const analytics = extractSuccess(getAnalytics, 'retrieve analytics');

  assert(Array.isArray(analytics.sales.daily), 'sales.daily should be an array');
  assert(Array.isArray(analytics.revenue.daily), 'revenue.daily should be an array');

  console.log('DEBUG: vipTicket is:', vipTicket);
  console.log('DEBUG: analytics.ticketTypes is:', JSON.stringify(analytics.ticketTypes, null, 2));

  // Verify ticketTypes breakdowns
  const vipBreakdown = analytics.ticketTypes.find((t: any) => t.slug === vipTicket.slug || t.name === vipTicket.name || t.ticketTypeId === vipTicket.id);
  assert(vipBreakdown, 'VIP ticket breakdown not found');
  assert(vipBreakdown.soldQuantity === 1, `Expected VIP soldQuantity = 1, got ${vipBreakdown.soldQuantity}`);
  assert(vipBreakdown.reservedQuantity === 0, `Expected VIP reservedQuantity = 0, got ${vipBreakdown.reservedQuantity}`);
  assert(vipBreakdown.availableQuantity === 1, `Expected VIP availableQuantity = 1, got ${vipBreakdown.availableQuantity}`);
  assert(vipBreakdown.checkInCount === 1, `Expected VIP checkInCount = 1, got ${vipBreakdown.checkInCount}`);
  assert(vipBreakdown.revenueContribution === 20000, `Expected VIP revenueContribution = 20000, got ${vipBreakdown.revenueContribution}`);
  assert(vipBreakdown.utilizationPercentage === 50.0, `Expected VIP utilizationPercentage = 50.0, got ${vipBreakdown.utilizationPercentage}`);

  const gaBreakdown = analytics.ticketTypes.find((t: any) => t.slug === generalTicket.slug || t.name === generalTicket.name || t.ticketTypeId === generalTicket.id);
  assert(gaBreakdown, 'GA ticket breakdown not found');
  assert(gaBreakdown.soldQuantity === 2, `Expected GA soldQuantity = 2, got ${gaBreakdown.soldQuantity}`);
  assert(gaBreakdown.reservedQuantity === 1, `Expected GA reservedQuantity = 1, got ${gaBreakdown.reservedQuantity}`);
  assert(gaBreakdown.availableQuantity === 95, `Expected GA availableQuantity = 95, got ${gaBreakdown.availableQuantity}`);
  assert(gaBreakdown.checkInCount === 0, `Expected GA checkInCount = 0, got ${gaBreakdown.checkInCount}`);
  assert(gaBreakdown.revenueContribution === 10000, `Expected GA revenueContribution = 10000, got ${gaBreakdown.revenueContribution}`);
  assert(gaBreakdown.utilizationPercentage === 2.0, `Expected GA utilizationPercentage = 2.0, got ${gaBreakdown.utilizationPercentage}`);

  // Verify conversions
  assert(analytics.conversions.bookingToConfirmedRate === 50.0, `Expected bookingToConfirmedRate = 50.0, got ${analytics.conversions.bookingToConfirmedRate}`);

  // 8. Test Endpoint 3: GET /events/:slug/live-status
  console.log('Testing GET /events/:slug/live-status...');
  const getLiveStatus = await request<ApiSuccess<any>>(`/events/${event.slug}/live-status`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const liveStatus = extractSuccess(getLiveStatus, 'retrieve live status');
  assert(liveStatus.currentlyCheckedIn === 1, `Expected currentlyCheckedIn = 1, got ${liveStatus.currentlyCheckedIn}`);
  assert(liveStatus.remainingExpected === 2, `Expected remainingExpected = 2, got ${liveStatus.remainingExpected}`);
  assert(liveStatus.currentCheckInRate === '33.3%', `Expected currentCheckInRate = 33.3%, got ${liveStatus.currentCheckInRate}`);
  // We performed two scanner validation rejections today: Scan 3 (already_checked_in) and Scan 4 (invalid_qr)
  assert(liveStatus.validationFailuresToday === 2, `Expected validationFailuresToday = 2, got ${liveStatus.validationFailuresToday}`);

  // 9. Test Endpoint 4: GET /events/:slug/inventory-summary
  console.log('Testing GET /events/:slug/inventory-summary...');
  const getInventory = await request<ApiSuccess<any[]>>(`/events/${event.slug}/inventory-summary`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const inventory = extractSuccess(getInventory, 'retrieve inventory summary');
  assert(inventory.length === 2, 'Should return exactly 2 ticket types');

  const vipInv = inventory.find((t) => t.ticketTypeName === 'VIP Garba Pass');
  assert(vipInv.totalInventory === 2, `Expected totalInventory = 2, got ${vipInv.totalInventory}`);
  assert(vipInv.soldInventory === 1, `Expected soldInventory = 1, got ${vipInv.soldInventory}`);
  assert(vipInv.reservedInventory === 0, `Expected reservedInventory = 0, got ${vipInv.reservedInventory}`);
  assert(vipInv.availableInventory === 1, `Expected availableInventory = 1, got ${vipInv.availableInventory}`);
  assert(vipInv.utilizationPercentage === 50.0, `Expected utilizationPercentage = 50.0, got ${vipInv.utilizationPercentage}`);

  // 10. Test Endpoint 5: GET /events/:slug/attendee-summary
  console.log('Testing GET /events/:slug/attendee-summary...');
  const getAttendeeSummary = await request<ApiSuccess<any>>(`/events/${event.slug}/attendee-summary`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const attendeeSummary = extractSuccess(getAttendeeSummary, 'retrieve attendee summary');
  assert(attendeeSummary.registeredAttendees === 2, `Expected registeredAttendees = 2, got ${attendeeSummary.registeredAttendees}`);
  assert(attendeeSummary.assignedAttendees === 2, `Expected assignedAttendees = 2, got ${attendeeSummary.assignedAttendees}`);
  assert(attendeeSummary.checkedInAttendees === 1, `Expected checkedInAttendees = 1, got ${attendeeSummary.checkedInAttendees}`);
  assert(attendeeSummary.pendingAttendees === 1, `Expected pendingAttendees = 1, got ${attendeeSummary.pendingAttendees}`);
  assert(attendeeSummary.attendeeCompletionPercentage === 100.0, `Expected completion percentage = 100.0, got ${attendeeSummary.attendeeCompletionPercentage}`);

  // 11. Test Endpoint 6: GET /events/:slug/checkin-summary
  console.log('Testing GET /events/:slug/checkin-summary...');
  const getCheckinSummary = await request<ApiSuccess<any>>(`/events/${event.slug}/checkin-summary`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const checkinSummary = extractSuccess(getCheckinSummary, 'retrieve check-in summary');
  assert(checkinSummary.checkedInCount === 1, `Expected checkedInCount = 1, got ${checkinSummary.checkedInCount}`);
  assert(checkinSummary.notCheckedInCount === 2, `Expected notCheckedInCount = 2, got ${checkinSummary.notCheckedInCount}`);
  assert(checkinSummary.duplicateScanAttempts === 1, `Expected duplicateScanAttempts = 1, got ${checkinSummary.duplicateScanAttempts}`);
  assert(checkinSummary.invalidScanAttempts === 1, `Expected invalidScanAttempts = 1, got ${checkinSummary.invalidScanAttempts}`);
  // We had 4 scan events: Scan 1 (valid), Checkin 1 (valid), Scan 3 (already_checked_in), Scan 4 (invalid_qr)
  // Successful validations = 2 (Scan 1 & Checkin 1). So validationSuccessRate = (2 / 4) * 100 = 50%
  assert(checkinSummary.validationSuccessRate === 50, `Expected validationSuccessRate = 50, got ${checkinSummary.validationSuccessRate}`);

  // 12. Test Endpoint 7: GET /events/:slug/activity
  console.log('Testing GET /events/:slug/activity...');
  const getActivity = await request<ApiSuccess<any[]>>(`/events/${event.slug}/activity?limit=50`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const activity = extractSuccess(getActivity, 'retrieve activity feed');
  assert(activity.length >= 5, `Expected at least 5 activities, got ${activity.length}`);

  const activityTypes = activity.map((a) => a.activityType);
  assert(activityTypes.includes('booking_created'), 'Activity feed should include booking_created');
  assert(activityTypes.includes('booking_confirmed'), 'Activity feed should include booking_confirmed');
  assert(activityTypes.includes('attendee_registered'), 'Activity feed should include attendee_registered');
  assert(activityTypes.includes('ticket_checked_in'), 'Activity feed should include ticket_checked_in');
  assert(activityTypes.includes('ticket_validation_rejected'), 'Activity feed should include ticket_validation_rejected');

  // Verify cursor-based pagination
  const lastActivity = activity[2];
  const paginatedActivityRes = await request<ApiSuccess<any[]>>(`/events/${event.slug}/activity?limit=2&cursor=${lastActivity.createdAt}`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const paginatedActivity = extractSuccess(paginatedActivityRes, 'retrieve paginated activity feed');
  assert(paginatedActivity.length <= 2, 'Cursor limit check failed');
  if (paginatedActivity.length > 0) {
    const dates = paginatedActivity.map((a) => new Date(a.createdAt).getTime());
    const boundary = new Date(lastActivity.createdAt).getTime();
    assert(dates.every((d) => d < boundary), 'Cursor pagination returned elements after/at cursor date');
  }

  // 13. Tenant Isolation & RBAC checks
  console.log('Running security checks...');
  // Outsider (non-member) cannot access dashboard
  const outsiderDashboard = await request(`/events/${event.slug}/dashboard`, {
    headers: authHeaders(outsider.tokens.accessToken, tenant.slug)
  });
  expectStatus(outsiderDashboard, [403, 404], 'Outsider should be denied access to the dashboard');

  // Valid tenant member but viewer role cannot access dashboard
  // Let's create a viewer member in the tenant first
  const viewer = await signup('analytics_viewer', 'Analytics Viewer');
  const addViewer = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: viewer.user.id, role: 'viewer' }
  });
  extractSuccess(addViewer, 'add viewer');

  const viewerDashboard = await request(`/events/${event.slug}/dashboard`, {
    headers: authHeaders(viewer.tokens.accessToken, tenant.slug)
  });
  expectStatus(viewerDashboard, [403], 'Viewer should be denied access to the dashboard');

  console.log('EVENT DASHBOARD & ANALYTICS SMOKE TEST PASSED!');
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nEVENT DASHBOARD & ANALYTICS SMOKE TEST FAILED\n');
    console.error(error);
    process.exit(1);
  });

