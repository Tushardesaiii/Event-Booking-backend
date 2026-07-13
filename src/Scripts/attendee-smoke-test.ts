const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

type JsonRecord = Record<string, unknown>;

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

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
  name: string;
}

interface VenueRecord {
  id: string;
  slug: string;
  city: string;
}

interface EventRecord {
  id: string;
  slug: string;
  title: string;
}

interface TicketTypeRecord {
  id: string;
  tenantId: string;
  eventId: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'paused' | 'sold_out' | 'archived';
  deletedAt: string | null;
}

interface AttendeeRecord {
  id: string;
  tenantId: string;
  eventId: string;
  ticketTypeId: string;
  fullName: string;
  email: string;
  phone: string;
  city: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'checked_in' | 'no_show';
  checkedInAt: string | null;
  checkedInByUserId: string | null;
  updatedAt: string;
  deletedAt: string | null;
  eventTitle?: string | null;
  ticketTypeName?: string | null;
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headersToObject(options.headers)
    },
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  });

  const raw = await response.text();
  let data: T | ApiError | null = null;
  let meta: PaginationMeta | undefined;

  if (raw.trim().length > 0) {
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

async function signupUser(prefix: string, label: string) {
  const timestamp = Date.now();
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const payload = {
    username: `${prefix}_${timestamp}`,
    fullName: `${label} User`,
    email: `${prefix}_${timestamp}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+91999911${phoneSuffix}`
  };

  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: payload
  });
  const { verificationSessionId } = extractSuccess(startResponse, `${label} signup start`);

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });

  return extractSuccess(verifyResponse, `${label} signup verify`);
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: { name, description: `Tenant for ${name}` }
  });

  return extractSuccess(response, 'create tenant');
}

async function createVenue(accessToken: string, tenantSlug: string, suffix: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      name: `Navratri Arena ${suffix}`,
      addressLine1: 'SG Highway',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India'
    }
  });

  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string, suffix: string) {
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: {
      title: `Royal Garba Night ${suffix}`,
      shortDescription: 'Flagship Garba night for Navratri season',
      description: 'Large-scale Ahmedabad Navratri event foundation test.',
      startDateTime: '2026-10-16T14:00:00.000Z',
      endDateTime: '2026-10-16T20:00:00.000Z',
      timezone: 'Asia/Kolkata',
      venueId,
      status: 'draft',
      visibility: 'public',
      isFeatured: true
    }
  });

  return extractSuccess(response, 'create event');
}

async function createTicketType(accessToken: string, tenantSlug: string, body: JsonRecord, label: string) {
  const response = await request<ApiSuccess<TicketTypeRecord>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body
  });

  const ticketType = extractSuccess(response, label);
  assert(ticketType.slug.length > 0, `${label}: missing slug`, ticketType);
  return ticketType;
}

async function createAttendee(accessToken: string, tenantSlug: string, body: JsonRecord, label: string) {
  const response = await request<ApiSuccess<AttendeeRecord>>('/attendees', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body
  });

  const attendee = extractSuccess(response, label);
  assert(attendee.id.length > 0, `${label}: missing id`, attendee);
  return attendee;
}

async function listAttendees(accessToken: string, tenantSlug: string, query: string, label: string) {
  const response = await request<ApiSuccess<AttendeeRecord[]>>(`/attendees${query}`, {
    method: 'GET',
    headers: authHeaders(accessToken, tenantSlug)
  });

  const payload = extractSuccess(response, label);
  assert(Array.isArray(payload), `${label}: expected array`, payload);
  assert(response.meta && typeof response.meta.total === 'number', `${label}: missing pagination meta`, response.data ?? response.raw);
  return { items: payload, meta: response.meta };
}

async function updateAttendee(accessToken: string, tenantSlug: string, id: string, body: JsonRecord, label: string, lastKnownUpdatedAt: string) {
  const response = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${id}`, {
    method: 'PATCH',
    headers: authHeaders(accessToken, tenantSlug),
    body: { ...body, lastKnownUpdatedAt }
  });

  return extractSuccess(response, label);
}

async function getAttendee(accessToken: string, tenantSlug: string, id: string, label: string) {
  const response = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${id}`, {
    method: 'GET',
    headers: authHeaders(accessToken, tenantSlug)
  });

  return extractSuccess(response, label);
}

async function run() {
  console.log('ATTENDEE SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  const ownerA = await signupUser('attendee_owner_a', 'Owner A');
  const viewerA = await signupUser('attendee_viewer_a', 'Viewer A');
  const ownerB = await signupUser('attendee_owner_b', 'Owner B');

  const tenantA = await createTenant(ownerA.tokens.accessToken, 'Ahmedabad Navratri Attendance');
  const tenantB = await createTenant(ownerB.tokens.accessToken, 'Surat Festival Attendance');

  const addViewer = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken),
    body: { userId: viewerA.user.id, role: 'viewer' }
  });
  extractSuccess(addViewer, 'add viewer to tenant A');

  const venue = await createVenue(ownerA.tokens.accessToken, tenantA.slug, 'A');
  const event = await createEvent(ownerA.tokens.accessToken, tenantA.slug, venue.id, '2026');

  const vipTicket = await createTicketType(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    name: 'Royal Garba VIP Pass',
    description: 'Premium entry and front-row access',
    price: 2500,
    currency: 'INR',
    taxBehavior: 'exclusive',
    totalQuantity: 150,
    soldQuantity: 10,
    reservedQuantity: 10,
    minPerOrder: 1,
    maxPerOrder: 6,
    visibility: 'public',
    status: 'active',
    isTransferable: true,
    isRefundable: true
  }, 'create vip ticket');

  const coupleTicket = await createTicketType(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    name: 'Couple Entry Pass',
    description: 'Entry for two attendees',
    price: 1800,
    currency: 'INR',
    taxBehavior: 'inclusive',
    totalQuantity: 200,
    soldQuantity: 0,
    reservedQuantity: 0,
    minPerOrder: 1,
    maxPerOrder: 2,
    visibility: 'hidden',
    status: 'active',
    isTransferable: false,
    isRefundable: false
  }, 'create couple ticket');

  const dandiyaTicket = await createTicketType(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    name: 'Dandiya Participant Pass',
    description: 'General participant access',
    price: 750,
    currency: 'INR',
    taxBehavior: 'inclusive',
    totalQuantity: 500,
    soldQuantity: 0,
    reservedQuantity: 0,
    minPerOrder: 1,
    maxPerOrder: 10,
    visibility: 'public',
    status: 'active',
    isTransferable: true,
    isRefundable: false
  }, 'create dandiya ticket');

  const invalidAttendee = await request<ApiSuccess<AttendeeRecord>>('/attendees', {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: {
      eventId: event.id,
      ticketTypeId: vipTicket.id,
      fullName: 'Invalid Mobile',
      email: 'not-an-email',
      phone: 'abc'
    }
  });
  expectStatus(invalidAttendee, [400], 'attendee email and phone validation');

  const viewerCreate = await request<ApiSuccess<AttendeeRecord>>('/attendees', {
    method: 'POST',
    headers: authHeaders(viewerA.tokens.accessToken, tenantA.slug),
    body: {
      eventId: event.id,
      ticketTypeId: vipTicket.id,
      fullName: 'Viewer Cannot Create',
      email: 'viewer.cannot.create@example.com',
      phone: '+919999999999'
    }
  });
  expectStatus(viewerCreate, [403], 'RBAC protection on attendee create');

  const rahul = await createAttendee(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    ticketTypeId: vipTicket.id,
    fullName: 'Rahul Patel',
    email: 'rahul.patel@example.com',
    phone: '+919898989898',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'India',
    status: 'confirmed',
    notes: 'VIP guest list'
  }, 'create rahul attendee');

  const priya = await createAttendee(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    ticketTypeId: coupleTicket.id,
    fullName: 'Priya Shah',
    email: 'priya.shah@example.com',
    phone: '+919012345678',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'India',
    status: 'pending'
  }, 'create priya attendee');

  const arjun = await createAttendee(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    ticketTypeId: coupleTicket.id,
    fullName: 'Arjun Desai',
    email: 'arjun.desai@example.com',
    phone: '+919111111111',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'India',
    status: 'pending'
  }, 'create arjun attendee');

  const kavya = await createAttendee(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    ticketTypeId: dandiyaTicket.id,
    fullName: 'Kavya Joshi',
    email: 'kavya.joshi@example.com',
    phone: '+919222222222',
    city: 'Surat',
    state: 'Gujarat',
    country: 'India',
    status: 'pending'
  }, 'create kavya attendee');

  const cancelled = await createAttendee(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    ticketTypeId: vipTicket.id,
    fullName: 'Neha Mehta',
    email: 'neha.mehta@example.com',
    phone: '+919333333333',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'India',
    status: 'cancelled'
  }, 'create cancelled attendee');

  const crossTenantRead = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${rahul.id}`, {
    method: 'GET',
    headers: authHeaders(ownerB.tokens.accessToken, tenantA.slug)
  });
  expectStatus(crossTenantRead, [403], 'tenant isolation read');

  const getRahul = await getAttendee(ownerA.tokens.accessToken, tenantA.slug, rahul.id, 'get attendee by id');
  assert(getRahul.id === rahul.id, 'attendee id mismatch', getRahul);
  assert(getRahul.ticketTypeId === vipTicket.id, 'ticket type linkage mismatch', getRahul);

  const searchResult = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, '?search=rahul', 'search attendees');
  assert(searchResult.items.some((item) => item.id === rahul.id), 'search should find Rahul', searchResult.items);

  const pageResult = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, '?page=1&limit=2', 'paginate attendees');
  assert(pageResult.meta?.total === 5, 'attendee list should contain 5 active items', pageResult.meta);
  assert(pageResult.items.length === 2, 'pagination should limit page size to 2', pageResult.items);

  const eventFilter = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, `?eventId=${event.id}`, 'filter by event');
  assert(eventFilter.items.length === 5, 'event filter should return all tenant event attendees', eventFilter.items);

  const ticketFilter = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, `?ticketTypeId=${coupleTicket.id}`, 'filter by ticket type');
  assert(ticketFilter.items.length === 2, 'ticket filter should return couple attendees', ticketFilter.items);

  const statusFilter = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, '?status=confirmed', 'filter by status');
  assert(statusFilter.items.some((item) => item.id === rahul.id), 'status filter should include confirmed attendee', statusFilter.items);

  const cityFilter = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, '?city=Ahmedabad', 'filter by city');
  assert(cityFilter.items.length >= 3, 'city filter should include Ahmedabad attendees', cityFilter.items);

  const sortedByName = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, '?sortBy=fullName&sortOrder=asc', 'sort by full name');
  assert(sortedByName.items[0].fullName === 'Arjun Desai', 'sorting by fullName should be asc', sortedByName.items);

  const updateRahul = await updateAttendee(ownerA.tokens.accessToken, tenantA.slug, rahul.id, {
    status: 'no_show',
    notes: 'Moved to no-show after gate close'
  }, 'update rahul attendee', getRahul.updatedAt);
  assert(updateRahul.status === 'no_show', 'rahul should be no_show', updateRahul);

  const staleRahulUpdate = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${rahul.id}`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: {
      status: 'confirmed',
      lastKnownUpdatedAt: getRahul.updatedAt
    }
  });
  expectStaleRequest(staleRahulUpdate, 'stale rahul attendee update');

  const checkInArjun = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${arjun.id}/check-in`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: arjun.updatedAt }
  });
  const checkedInArjun = extractSuccess(checkInArjun, 'check in arjun');
  assert(checkedInArjun.status === 'checked_in', 'arjun should be checked in', checkedInArjun);
  assert(checkedInArjun.checkedInAt !== null, 'checkedInAt should be populated', checkedInArjun);
  assert(checkedInArjun.checkedInByUserId === ownerA.user.id, 'checkedInByUserId should be actor', checkedInArjun);

  const doubleCheckIn = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${arjun.id}/check-in`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: arjun.updatedAt }
  });
  expectStatus(doubleCheckIn, [409], 'double check-in prevention');

  const revertArjun = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${arjun.id}/revert-check-in`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: checkedInArjun.updatedAt }
  });
  const revertedArjun = extractSuccess(revertArjun, 'revert arjun check-in');
  assert(revertedArjun.status === 'confirmed', 'reverted attendee should return to confirmed', revertedArjun);
  assert(revertedArjun.checkedInAt === null, 'checkedInAt should be cleared', revertedArjun);

  const invalidCheckIn = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${cancelled.id}/check-in`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: cancelled.updatedAt }
  });
  expectStatus(invalidCheckIn, [400], 'invalid check-in for cancelled attendee');

  const invalidRevert = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${kavya.id}/revert-check-in`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: kavya.updatedAt }
  });
  expectStatus(invalidRevert, [400], 'revert prevention for non checked-in attendee');

  const deletePriya = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${priya.id}`, {
    method: 'DELETE',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: { lastKnownUpdatedAt: priya.updatedAt }
  });
  const deletedPriya = extractSuccess(deletePriya, 'delete priya attendee');
  assert(deletedPriya.deletedAt !== null, 'deleted attendee should have deletedAt', deletedPriya);

  const deletedLookup = await request<ApiSuccess<AttendeeRecord>>(`/attendees/${priya.id}`, {
    method: 'GET',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  expectStatus(deletedLookup, [404], 'deleted attendee should not be retrievable');

  const postDeleteList = await listAttendees(ownerA.tokens.accessToken, tenantA.slug, '', 'list after delete');
  assert(!postDeleteList.items.some((item) => item.id === priya.id), 'soft-deleted attendee should be excluded', postDeleteList.items);

  const tenantBList = await listAttendees(ownerB.tokens.accessToken, tenantB.slug, '', 'tenant B empty attendee list');
  assert(tenantBList.items.length === 0, 'tenant B should not see tenant A attendees', tenantBList.items);

  console.log('ATTENDEE SMOKE TEST PASSED');
}

run().catch((error) => {
  console.error('ATTENDEE SMOKE TEST FAILED');
  console.error(error);
  process.exit(1);
});

export {};