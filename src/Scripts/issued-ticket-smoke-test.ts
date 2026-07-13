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

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

interface AuthResult {
  user: { id: string; username: string; email: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface TenantRecord { id: string; slug: string; }
interface VenueRecord { id: string; }
interface EventRecord { id: string; }
interface BookingOrderRecord { id: string; orderNumber: string; status: string; updatedAt: string; }
interface BookingOrderItemRecord { id: string; quantity: number; ticketTypeId: string; }
interface BookingAttendeeRecord { attendeeId: string; attendeeEmail: string; bookingOrderItemId: string; }
interface IssuedTicketRecord {
  id: string;
  ticketNumber: string;
  qrCodeToken: string;
  status: 'issued' | 'checked_in' | 'cancelled' | 'transferred' | 'refunded' | 'invalidated';
  attendeeId: string | null;
  bookingOrderId: string;
  bookingOrderItemId: string;
  validationCount: number;
  successfulValidationCount: number;
  failedValidationCount: number;
  lastValidationAttemptAt: string | null;
  lastSuccessfulValidationAt: string | null;
  lastValidationFailureReason: string | null;
  lastValidationSource: string | null;
  lastScannerDeviceId: string | null;
  lastScannerGate: string | null;
  lastScannerOperatorUserId: string | null;
  updatedAt: string;
  deletedAt: string | null;
  ticketTypeNameSnapshot: string;
  ticketTypeSlugSnapshot: string;
  unitPriceSnapshot: string;
  currencySnapshot: string;
  attendeeFullName: string | null;
  attendeeEmail: string | null;
  bookingOrderNumber: string | null;
  bookingOrderItemQuantity: number | null;
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
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
      data = parsed as T | ApiError;
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
    body: {
      fullName: displayName,
      username: `${prefix}_${stamp}`,
      email: `${prefix}_${stamp}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: `+91999900${phoneSuffix}`
    }
  });
  const { verificationSessionId } = extractSuccess(startResponse, `signup start ${displayName}`);

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });
  return extractSuccess(verifyResponse, `${displayName} signup`);
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', { method: 'POST', headers: authHeaders(accessToken), body: { name, description: `${name} tenant` } });
  return extractSuccess(response, `create tenant ${name}`);
}

async function createVenue(accessToken: string, tenantSlug: string, suffix: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: { name: `Navratri Dome ${suffix}`, addressLine1: 'SG Highway', city: 'Ahmedabad', state: 'Gujarat', country: 'India', capacity: 50000 }
  });
  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string, suffix: string) {
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
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
  console.log('ISSUED TICKET SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  const owner = await signup('issued_ticket_owner', 'Issued Ticket Owner');
  const manager = await signup('issued_ticket_manager', 'Issued Ticket Manager');
  const outsider = await signup('issued_ticket_outsider', 'Issued Ticket Outsider');

  const tenant = await createTenant(owner.tokens.accessToken, 'Ahmedabad Navratri Ops Tickets');
  const outsiderTenant = await createTenant(outsider.tokens.accessToken, 'Surat Navratri Ops Tickets');

  const addManager = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: { userId: manager.user.id, role: 'manager' }
  });
  extractSuccess(addManager, 'add manager');

  const venue = await createVenue(owner.tokens.accessToken, tenant.slug, 'A');
  const event = await createEvent(owner.tokens.accessToken, tenant.slug, venue.id, '2026');

  const vipTicket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id, {
    name: 'VIP Garba Pass',
    price: 3500,
    totalQuantity: 4,
    slug: 'vip-garba-pass'
  });

  const generalTicket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id, {
    name: 'General Garba Pass',
    price: 1200,
    totalQuantity: 500,
    maxPerOrder: 20,
    slug: 'general-garba-pass'
  });

  const createBooking = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'confirmed',
      source: 'web',
      items: [
        { ticketTypeId: vipTicket.id, quantity: 2 },
        { ticketTypeId: generalTicket.id, quantity: 3 }
      ]
    }
  });
  const booking = extractSuccess(createBooking, 'create booking');

  const listAfterIssue = await request<ApiSuccess<IssuedTicketRecord[]>>('/issued-tickets?page=1&limit=10', {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const ticketsAfterIssue = extractSuccess(listAfterIssue, 'list issued tickets after booking creation');
  assert(Array.isArray(ticketsAfterIssue) && ticketsAfterIssue.length === 5, 'tickets should be issued on confirmed booking creation', ticketsAfterIssue);

  const bookingItems = await request<ApiSuccess<BookingOrderItemRecord[]>>(`/booking-orders/${booking.orderNumber}/items`, {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const orderItems = extractSuccess(bookingItems, 'get booking items');

  const attendees = [
    { fullName: 'Rahul Shah', email: 'rahul.shah@example.com', phone: '+919999000001', city: 'Ahmedabad', status: 'confirmed' },
    { fullName: 'Priya Patel', email: 'priya.patel@example.com', phone: '+919999000002', city: 'Ahmedabad', status: 'confirmed' },
    { fullName: 'Aarav Mehta', email: 'aarav.mehta@example.com', phone: '+919999000003', city: 'Ahmedabad', status: 'confirmed' },
    { fullName: 'Mira Shah', email: 'mira.shah@example.com', phone: '+919999000004', city: 'Ahmedabad', status: 'confirmed' },
    { fullName: 'Karan Patel', email: 'karan.patel@example.com', phone: '+919999000005', city: 'Ahmedabad', status: 'confirmed' }
  ];

  const assign = await request<ApiSuccess<BookingAttendeeRecord[]>>(`/booking-orders/${booking.orderNumber}/assign-attendees`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      assignments: [
        { bookingOrderItemId: orderItems[0].id, attendee: attendees[0] },
        { bookingOrderItemId: orderItems[0].id, attendee: attendees[1] },
        { bookingOrderItemId: orderItems[1].id, attendee: attendees[2] },
        { bookingOrderItemId: orderItems[1].id, attendee: attendees[3] }
      ]
    }
  });
  extractSuccess(assign, 'assign attendees');

  const refreshedTickets = await request<ApiSuccess<IssuedTicketRecord[]>>(`/issued-tickets?bookingOrderId=${booking.id}`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const reconciledTickets = extractSuccess(refreshedTickets, 'refresh issued tickets after assignment');
  assert(reconciledTickets.some((ticket) => ticket.attendeeFullName !== null), 'attendee linkage should be reconciled onto issued tickets', reconciledTickets);

  const listTickets = await request<ApiSuccess<IssuedTicketRecord[]>>('/issued-tickets?page=1&limit=100&status=issued&eventId=' + event.id, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const issued = extractSuccess(listTickets, 'list issued tickets');
  assert(issued.length === 5, 'five issued tickets should exist', issued);

  const firstTicket = issued.find((ticket) => ticket.ticketTypeNameSnapshot === 'VIP Garba Pass');
  assert(firstTicket, 'expected a VIP issued ticket', issued);

  const validateByToken = await request<ApiSuccess<{ valid: boolean; status: string; ticket: IssuedTicketRecord | null; validationSource: string; failureReason?: string | null }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { qrCodeToken: firstTicket!.qrCodeToken }
  });
  const validated = extractSuccess(validateByToken, 'validate ticket');
  assert(validated.valid === true, 'validation should pass', validated);
  assert(validated.status === 'valid', 'validation status should be valid', validated);
  assert(validated.ticket !== null, 'validated ticket should be returned', validated);
  assert(validated.ticket.ticketNumber === firstTicket.ticketNumber, 'validated ticket mismatch', validated);

  const replayValidation = await request<ApiSuccess<{ valid: boolean; status: string; ticket: IssuedTicketRecord | null; validationSource: string; failureReason?: string | null }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { qrCodeToken: firstTicket!.qrCodeToken }
  });
  const replayed = extractSuccess(replayValidation, 'replay validation');
  assert(replayed.valid === true, 'replayed validation should remain valid', replayed);
  assert(replayed.status === 'valid', 'replayed validation should remain valid', replayed);

  const invalidQrValidation = await request<ApiSuccess<{ valid: boolean; status: string; ticket: IssuedTicketRecord | null; validationSource: string; failureReason?: string | null }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { qrCodeToken: 'not-a-real-token' }
  });
  const invalidQr = extractSuccess(invalidQrValidation, 'invalid qr validation');
  assert(invalidQr.valid === false && invalidQr.status === 'invalid_qr', 'invalid qr should be rejected safely', invalidQr);

  const tenantMismatchValidation = await request<ApiSuccess<{ valid: boolean; status: string; ticket: IssuedTicketRecord | null; validationSource: string; failureReason?: string | null }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(outsider.tokens.accessToken, outsiderTenant.slug),
    body: { qrCodeToken: firstTicket!.qrCodeToken }
  });
  const tenantMismatch = extractSuccess(tenantMismatchValidation, 'tenant mismatch validation');
  assert(tenantMismatch.valid === false && tenantMismatch.status === 'tenant_mismatch', 'cross-tenant qr usage should be rejected', tenantMismatch);

  const checkIn = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${firstTicket.ticketNumber}/check-in`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { lastKnownUpdatedAt: (replayed.ticket ?? validated.ticket).updatedAt }
  });
  const checkedIn = extractSuccess(checkIn, 'check in ticket');
  assert(checkedIn.status === 'checked_in', 'ticket should be checked in', checkedIn);

  const concurrentTarget = issued.find((ticket) => ticket.ticketNumber !== firstTicket.ticketNumber && ticket.status === 'issued');
  assert(concurrentTarget, 'expected a second issued ticket for concurrency testing', issued);

  const parallelCheckIns = await Promise.all([
    request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${concurrentTarget!.ticketNumber}/check-in`, {
      method: 'POST',
      headers: authHeaders(manager.tokens.accessToken, tenant.slug),
      body: { lastKnownUpdatedAt: concurrentTarget!.updatedAt }
    }),
    request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${concurrentTarget!.ticketNumber}/check-in`, {
      method: 'POST',
      headers: authHeaders(manager.tokens.accessToken, tenant.slug),
      body: { lastKnownUpdatedAt: concurrentTarget!.updatedAt }
    })
  ]);

  const parallelSuccesses = parallelCheckIns.filter((result) => result.ok);
  assert(parallelSuccesses.length >= 1, 'parallel check-in should produce at least one success', parallelCheckIns);
  assert(parallelCheckIns.every((result) => result.status === 200 || result.status === 409), 'parallel check-in should fail safely or succeed idempotently', parallelCheckIns);

  const duplicateCheckIn = await request(`/issued-tickets/${firstTicket.ticketNumber}/check-in`, {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { lastKnownUpdatedAt: checkedIn.updatedAt }
  });
  expectStatus(duplicateCheckIn, [409], 'duplicate check in idempotency');


  const invalidStatusPatch = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${firstTicket.ticketNumber}`, {
    method: 'PATCH',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { status: 'issued', lastKnownUpdatedAt: checkedIn.updatedAt }
  });
  expectStatus(invalidStatusPatch, [409, 400], 'invalid ticket status prevention');

  const listCheckedIn = await request<ApiSuccess<IssuedTicketRecord[]>>('/issued-tickets?page=1&limit=10&checkedIn=true', {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const checkedInTickets = extractSuccess(listCheckedIn, 'list checked-in tickets');
  assert(checkedInTickets.some((ticket) => ticket.ticketNumber === firstTicket.ticketNumber), 'checked-in filter should include scanned ticket', checkedInTickets);

  const crossTenantRead = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${firstTicket.ticketNumber}`, {
    headers: authHeaders(outsider.tokens.accessToken, outsiderTenant.slug)
  });
  expectStatus(crossTenantRead, [404, 403], 'cross-tenant isolation');

  const staleDelete = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${issued[1].ticketNumber}`, {
    method: 'DELETE',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { lastKnownUpdatedAt: '2001-01-01T00:00:00.000Z' }
  });
  expectStaleRequest(staleDelete, 'stale request protection');

  const deleteTicket = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${issued[1].ticketNumber}`, {
    method: 'DELETE',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { lastKnownUpdatedAt: issued[1].updatedAt }
  });
  const deleted = extractSuccess(deleteTicket, 'delete issued ticket');
  assert(deleted.deletedAt !== null, 'deleted ticket should be soft deleted', deleted);

  const deletedTicketValidation = await request<ApiSuccess<{ valid: boolean; status: string; ticket: IssuedTicketRecord | null; validationSource: string; failureReason?: string | null }>>('/issued-tickets/validate', {
    method: 'POST',
    headers: authHeaders(manager.tokens.accessToken, tenant.slug),
    body: { ticketNumber: deleted.ticketNumber }
  });
  const deletedValidation = extractSuccess(deletedTicketValidation, 'deleted ticket validation');
  assert(deletedValidation.valid === false && deletedValidation.status === 'deleted', 'deleted tickets should remain audit-visible but rejected', deletedValidation);

  const fetchDeleted = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${issued[1].ticketNumber}`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  expectStatus(fetchDeleted, [404], 'soft deleted ticket should not be readable');

  const cancelableBooking = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'confirmed',
      source: 'web',
      items: [{ ticketTypeId: generalTicket.id, quantity: 1 }]
    }
  });
  const cancelable = extractSuccess(cancelableBooking, 'create cancelable booking');

  const cancelableTicketList = await request<ApiSuccess<IssuedTicketRecord[]>>(`/issued-tickets?bookingOrderId=${cancelable.id}`, {
    headers: authHeaders(manager.tokens.accessToken, tenant.slug)
  });
  const cancelableTickets = extractSuccess(cancelableTicketList, 'list cancelable booking tickets');
  assert(cancelableTickets.length === 1, 'cancelable booking should issue one ticket', cancelableTickets);

  const cancelBooking = await request<ApiSuccess<BookingOrderRecord>>(`/booking-orders/${cancelable.orderNumber}`, {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: { status: 'cancelled', cancellationReason: 'Event cancelled', lastKnownUpdatedAt: cancelable.updatedAt }
  });
  extractSuccess(cancelBooking, 'cancel booking');

  const cancelledTicketLookup = await request<ApiSuccess<IssuedTicketRecord>>(`/issued-tickets/${cancelableTickets[0].ticketNumber}`, {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  expectStatus(cancelledTicketLookup, [200], 'cancelled ticket lookup remains available for audit');
  const cancelledTicket = extractSuccess(cancelledTicketLookup, 'fetch cancelled ticket');
  assert(cancelledTicket.status === 'cancelled', 'cancelled booking should cancel issued ticket', cancelledTicket);
  console.log('ISSUED TICKET SMOKE TEST PASSED');
}

run().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('\nISSUED TICKET SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});

export {};