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
  error: {
    code: string;
    details?: unknown;
  };
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

interface TenantRecord {
  id: string;
  slug: string;
}

interface VenueRecord {
  id: string;
}

interface EventRecord {
  id: string;
}

interface TicketTypeRecord {
  id: string;
  slug: string;
  updatedAt: string;
}

interface BookingOrderRecord {
  id: string;
  orderNumber: string;
  status: 'draft' | 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';
  totalAmount: string;
  updatedAt: string;
}

interface BookingOrderItemRecord {
  id: string;
  quantity: number;
  ticketTypeId: string;
}

interface BookingAttendeeRecord {
  attendeeId: string;
  attendeeEmail: string;
  bookingOrderItemId: string;
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function headersToObject(headers?: HeadersInit) {
  return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
}

function authHeaders(accessToken: string, tenantSlug?: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(tenantSlug ? { 'x-tenant-slug': tenantSlug } : {})
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...headersToObject(options.headers)
    },
    ...options
  });

  const raw = await response.text();
  let data: T | ApiError | null = null;
  let meta: PaginationMeta | undefined;

  if (raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw) as ApiSuccess<T> | ApiError;
      data = parsed as unknown as T | ApiError;

      if ((parsed as ApiSuccess<T>).success) {
        meta = (parsed as ApiSuccess<T>).meta;
      }
    } catch {
      data = null;
    }
  }

  if (VERBOSE) {
    console.log(`${response.status} ${options.method ?? 'GET'} ${path}`);
    if (raw.trim()) {
      console.log(raw);
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    meta,
    raw
  };
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

function expectStaleRequest(result: RequestResult<unknown>, label: string) {
  expectStatus(result, [409], label);
  const body = result.data as ApiError | null;
  assert(body?.error?.code === 'STALE_REQUEST', `${label} expected STALE_REQUEST`, result.data ?? result.raw);
}

async function signup(prefix: string, displayName: string) {
  const stamp = Date.now();
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      fullName: displayName,
      username: `${prefix}_${stamp}`,
      email: `${prefix}_${stamp}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: `+91999900${phoneSuffix}`
    })
  });
  const { verificationSessionId } = extractSuccess(startResponse, `signup start ${displayName}`);

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: JSON.stringify({
      verificationSessionId,
      code: '123456'
    })
  });
  return extractSuccess(verifyResponse, `${displayName} signup`);
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ name, description: `${name} tenant` })
  });

  return extractSuccess(response, `create tenant ${name}`);
}

async function createVenue(accessToken: string, tenantSlug: string, suffix: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      name: `Navratri Dome ${suffix}`,
      addressLine1: 'SG Highway',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      capacity: 50000
    })
  });

  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string, suffix: string) {
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      title: `Royal Navratri ${suffix}`,
      shortDescription: 'Massive Ahmedabad Garba festival',
      description: 'Navratri-scale load test event.',
      startDateTime: '2026-10-16T14:00:00.000Z',
      endDateTime: '2026-10-17T05:30:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId,
      isFeatured: true
    })
  });

  return extractSuccess(response, 'create event');
}

async function createTicketType(accessToken: string, tenantSlug: string, eventId: string, payload: Record<string, unknown>) {
  const response = await request<ApiSuccess<TicketTypeRecord>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
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
    })
  });

  return extractSuccess(response, 'create ticket type');
}

async function run() {
  console.log('BOOKING SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  const ownerA = await signup('booking_owner_a', 'Booking Owner A');
  const managerA = await signup('booking_manager_a', 'Booking Manager A');
  const ownerB = await signup('booking_owner_b', 'Booking Owner B');

  const tenantA = await createTenant(ownerA.tokens.accessToken, 'Ahmedabad Navratri Ops Booking');
  const tenantB = await createTenant(ownerB.tokens.accessToken, 'Surat Ticketing Ops Booking');

  const addManager = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken),
    body: JSON.stringify({ userId: managerA.user.id, role: 'manager' })
  });
  extractSuccess(addManager, 'add manager');

  const venue = await createVenue(ownerA.tokens.accessToken, tenantA.slug, 'A');
  const event = await createEvent(ownerA.tokens.accessToken, tenantA.slug, venue.id, '2026');

  const vipTicket = await createTicketType(ownerA.tokens.accessToken, tenantA.slug, event.id, {
    name: 'VIP Garba Pass',
    price: 3500,
    totalQuantity: 3
  });

  const coupleTicket = await createTicketType(ownerA.tokens.accessToken, tenantA.slug, event.id, {
    name: 'Couple Garba Pass',
    price: 5000,
    totalQuantity: 300,
    maxPerOrder: 20
  });

  const invalidInventoryBooking = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: ownerA.user.id,
      status: 'pending',
      source: 'web',
      items: [
        { ticketTypeId: vipTicket.id, quantity: 4 }
      ]
    })
  });
  expectStatus(invalidInventoryBooking, [409], 'invalid inventory prevention');

  const viewerCannotCreate = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(ownerB.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: ownerA.user.id,
      status: 'pending',
      source: 'web',
      items: [
        { ticketTypeId: vipTicket.id, quantity: 1 }
      ]
    })
  });
  expectStatus(viewerCannotCreate, [403], 'RBAC tenant isolation create guard');

  const createBooking = await request<ApiSuccess<BookingOrderRecord & { items: BookingOrderItemRecord[] }>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: ownerA.user.id,
      status: 'pending',
      source: 'web',
      discountAmount: 250,
      notes: 'VIP + couple family booking',
      items: [
        { ticketTypeId: vipTicket.id, quantity: 2, metadata: { zone: 'A' } },
        { ticketTypeId: coupleTicket.id, quantity: 4, metadata: { gate: 'North' } }
      ]
    })
  });
  const booking = extractSuccess(createBooking, 'create booking order');

  assert(booking.orderNumber.length > 0, 'booking order number should be present', booking);
  assert(booking.items.length === 2, 'booking should contain two items', booking);

  const listBookings = await request<ApiSuccess<BookingOrderRecord[]>>('/booking-orders?page=1&limit=10&status=pending&source=web', {
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const listed = extractSuccess(listBookings, 'list booking orders');
  assert(Array.isArray(listed), 'booking list should be array', listed);
  assert((listBookings.meta?.total ?? 0) >= 1, 'booking list should include totals', listBookings.data);

  const fetchByOrderNumber = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const fetchedBooking = extractSuccess(fetchByOrderNumber, 'get booking by order number');
  assert(fetchedBooking.id === booking.id, 'booking ID mismatch', fetchedBooking);

  const listItems = await request<ApiSuccess<BookingOrderItemRecord[]>>(`/booking-orders/${booking.orderNumber}/items`, {
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const bookingItems = extractSuccess(listItems, 'list booking items');
  assert(bookingItems.length === 2, 'booking items should be returned', bookingItems);

  const assignAttendees = await request<ApiSuccess<BookingAttendeeRecord[]>>(`/booking-orders/${booking.orderNumber}/assign-attendees`, {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      assignments: [
        {
          bookingOrderItemId: bookingItems[0].id,
          attendee: {
            fullName: 'Rahul Shah',
            email: 'rahul.shah@example.com',
            phone: '+919999000001',
            city: 'Ahmedabad',
            status: 'confirmed'
          }
        },
        {
          bookingOrderItemId: bookingItems[1].id,
          attendee: {
            fullName: 'Priya Patel',
            email: 'priya.patel@example.com',
            phone: '+919999000002',
            city: 'Ahmedabad',
            status: 'confirmed'
          }
        }
      ]
    })
  });
  const assigned = extractSuccess(assignAttendees, 'assign attendees');
  assert(assigned.length === 2, 'two attendees should be assigned', assigned);

  const listAttendees = await request<ApiSuccess<BookingAttendeeRecord[]>>(
    `/booking-orders/${booking.orderNumber}/attendees?page=1&limit=10&attendeeEmail=rahul.shah@example.com`,
    {
      headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug)
    }
  );
  const orderAttendees = extractSuccess(listAttendees, 'list booking attendees');
  assert(orderAttendees.length === 1, 'attendee filter should return one row', orderAttendees);

  const staleBookingUpdate = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      status: 'confirmed',
      lastKnownUpdatedAt: '2001-01-01T00:00:00.000Z'
    })
  });
  expectStaleRequest(staleBookingUpdate, 'booking stale protection');

  const confirmBooking = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      status: 'confirmed',
      notes: 'Confirmed by manager',
      lastKnownUpdatedAt: fetchedBooking.updatedAt
    })
  });
  const confirmedBooking = extractSuccess(confirmBooking, 'confirm booking');
  assert(confirmedBooking.status === 'confirmed', 'booking should move to confirmed', confirmedBooking);

  const invalidTransition = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      status: 'draft',
      lastKnownUpdatedAt: confirmedBooking.updatedAt
    })
  });
  expectStatus(invalidTransition, [400], 'invalid status transition prevention');

  const cancelBooking = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      status: 'cancelled',
      cancellationReason: 'Customer request',
      lastKnownUpdatedAt: confirmedBooking.updatedAt
    })
  });
  const cancelledBooking = extractSuccess(cancelBooking, 'cancel booking');
  assert(cancelledBooking.status === 'cancelled', 'booking should be cancelled', cancelledBooking);

  // Idempotent cancellation: applying the same terminal status again should succeed and not error
  const repeatCancel = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      status: 'cancelled',
      lastKnownUpdatedAt: cancelledBooking.updatedAt
    })
  });
  const repeatCancelled = extractSuccess(repeatCancel, 'repeat cancel booking');
  assert(repeatCancelled.status === 'cancelled', 'repeat cancellation should remain cancelled', repeatCancelled);

  const deleteCancelledBooking = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    method: 'DELETE',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({ lastKnownUpdatedAt: cancelledBooking.updatedAt })
  });
  const deletedBooking = extractSuccess(deleteCancelledBooking, 'soft delete booking');
  assert(deletedBooking.status === 'cancelled', 'deleted booking should remain cancelled', deletedBooking);

  const fetchDeletedBooking = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  expectStatus(fetchDeletedBooking, [404], 'soft deleted booking should not be readable');

  const crossTenantRead = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${booking.orderNumber}`, {
    headers: authHeaders(ownerB.tokens.accessToken, tenantB.slug)
  });
  expectStatus(crossTenantRead, [404, 403], 'cross-tenant booking isolation');

  const walkInBooking = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: ownerA.user.id,
      status: 'pending',
      source: 'walk_in',
      items: [
        { ticketTypeId: vipTicket.id, quantity: 1 }
      ]
    })
  });
  const walkIn = extractSuccess(walkInBooking, 'walk-in booking');
  assert(walkIn.orderNumber.includes('-'), 'walk-in booking should have professional order number', walkIn);

  console.log('BOOKING SMOKE TEST PASSED');
}

run().catch((error) => {
  console.error('\nBOOKING SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});

export {};
