const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

type JsonRecord = Record<string, unknown>;

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

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
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
  description: string | null;
  price: string;
  currency: string;
  taxBehavior: 'inclusive' | 'exclusive';
  totalQuantity: number;
  soldQuantity: number;
  reservedQuantity: number;
  minPerOrder: number;
  maxPerOrder: number;
  saleStartDate: string | null;
  saleEndDate: string | null;
  visibility: 'public' | 'hidden' | 'invite_only';
  status: 'draft' | 'active' | 'paused' | 'sold_out' | 'archived';
  isTransferable: boolean;
  isRefundable: boolean;
  updatedAt: string;
  deletedAt: string | null;
  availableQuantity?: number;
  eventTitle?: string | null;
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
  assert(typeof ticketType.availableQuantity === 'number', `${label}: missing availableQuantity`, ticketType);
  return ticketType;
}

async function listTicketTypes(accessToken: string, tenantSlug: string, query: string, label: string) {
  const response = await request<ApiSuccess<TicketTypeRecord[]>>(`/ticket-types${query}`, {
    method: 'GET',
    headers: authHeaders(accessToken, tenantSlug)
  });

  const payload = extractSuccess(response, label);
  assert(Array.isArray(payload), `${label}: expected array`, payload);
  assert(response.meta && typeof response.meta.total === 'number', `${label}: missing pagination meta`, response.data ?? response.raw);
  return { items: payload, meta: response.meta };
}

async function getTicketType(accessToken: string, tenantSlug: string, slug: string, label: string) {
  const response = await request<ApiSuccess<TicketTypeRecord>>(`/ticket-types/${slug}`, {
    method: 'GET',
    headers: authHeaders(accessToken, tenantSlug)
  });

  return extractSuccess(response, label);
}

async function updateTicketType(accessToken: string, tenantSlug: string, slug: string, body: JsonRecord, label: string, lastKnownUpdatedAt: string) {
  const response = await request<ApiSuccess<TicketTypeRecord>>(`/ticket-types/${slug}`, {
    method: 'PATCH',
    headers: authHeaders(accessToken, tenantSlug),
    body: { ...body, lastKnownUpdatedAt }
  });

  return extractSuccess(response, label);
}

async function deleteTicketType(accessToken: string, tenantSlug: string, slug: string, label: string, lastKnownUpdatedAt: string) {
  const response = await request<ApiSuccess<TicketTypeRecord>>(`/ticket-types/${slug}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken, tenantSlug),
    body: { lastKnownUpdatedAt }
  });

  return extractSuccess(response, label);
}

async function run() {
  console.log('TICKET SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  const ownerA = await signupUser('ticket_owner_a', 'Owner A');
  const viewerA = await signupUser('ticket_viewer_a', 'Viewer A');
  const ownerB = await signupUser('ticket_owner_b', 'Owner B');

  const tenantA = await createTenant(ownerA.tokens.accessToken, 'Ahmedabad Navratri Tickets');
  const tenantB = await createTenant(ownerB.tokens.accessToken, 'Surat Music Tickets');

  const addViewer = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken),
    body: { userId: viewerA.user.id, role: 'viewer' }
  });
  extractSuccess(addViewer, 'add viewer to tenant A');

  const venue = await createVenue(ownerA.tokens.accessToken, tenantA.slug, 'A');
  const event = await createEvent(ownerA.tokens.accessToken, tenantA.slug, venue.id, '2026');

  const forbiddenCreate = await request<ApiSuccess<TicketTypeRecord>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(viewerA.tokens.accessToken, tenantA.slug),
    body: {
      eventId: event.id,
      name: 'Should Not Create',
      price: 100,
      totalQuantity: 10
    }
  });
  expectStatus(forbiddenCreate, [403], 'RBAC protection on ticket create');

  const invalidInventory = await request<ApiSuccess<TicketTypeRecord>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: {
      eventId: event.id,
      name: 'Invalid Inventory Pass',
      price: 500,
      totalQuantity: 50,
      soldQuantity: 60,
      reservedQuantity: 0,
      minPerOrder: 1,
      maxPerOrder: 4
    }
  });
  expectStatus(invalidInventory, [400], 'invalid inventory prevention');

  const invalidPurchaseLimits = await request<ApiSuccess<TicketTypeRecord>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: {
      eventId: event.id,
      name: 'Invalid Purchase Limits',
      price: 500,
      totalQuantity: 50,
      soldQuantity: 0,
      reservedQuantity: 0,
      minPerOrder: 5,
      maxPerOrder: 4
    }
  });
  expectStatus(invalidPurchaseLimits, [400], 'invalid purchase limits prevention');

  const vip = await createTicketType(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    name: 'Royal Garba VIP Pass',
    description: 'Premium seating and exclusive entry',
    price: 2500,
    currency: 'INR',
    taxBehavior: 'exclusive',
    totalQuantity: 150,
    soldQuantity: 20,
    reservedQuantity: 10,
    minPerOrder: 1,
    maxPerOrder: 6,
    saleStartDate: '2026-09-01T00:00:00.000Z',
    saleEndDate: '2026-10-15T23:59:59.000Z',
    visibility: 'public',
    status: 'draft',
    isTransferable: true,
    isRefundable: true
  }, 'create vip ticket');

  const couple = await createTicketType(ownerA.tokens.accessToken, tenantA.slug, {
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

  await createTicketType(ownerA.tokens.accessToken, tenantA.slug, {
    eventId: event.id,
    name: 'Early Bird Garba Ticket',
    description: 'Limited time early bird pricing',
    price: 999,
    currency: 'INR',
    taxBehavior: 'inclusive',
    totalQuantity: 80,
    soldQuantity: 0,
    reservedQuantity: 0,
    minPerOrder: 1,
    maxPerOrder: 4,
    visibility: 'invite_only',
    status: 'paused',
    isTransferable: true,
    isRefundable: false
  }, 'create early bird ticket');

  const crossTenantRead = await request<ApiSuccess<TicketTypeRecord>>(`/ticket-types/${vip.slug}`, {
    method: 'GET',
    headers: authHeaders(ownerB.tokens.accessToken, tenantA.slug)
  });
  expectStatus(crossTenantRead, [403], 'tenant isolation read');

  const getVip = await getTicketType(ownerA.tokens.accessToken, tenantA.slug, vip.slug, 'get vip ticket');
  assert(getVip.id === vip.id, 'vip ticket id mismatch', getVip);
  assert(typeof getVip.availableQuantity === 'number', 'vip ticket should include availableQuantity', getVip);

  const listPage = await listTicketTypes(ownerA.tokens.accessToken, tenantA.slug, '?page=1&limit=2', 'list ticket types');
  assert(listPage.meta?.total === 3, 'ticket list should contain 3 items', listPage.meta);
  assert(listPage.items.length === 2, 'pagination should limit page size to 2', listPage.items);

  const searchResult = await listTicketTypes(ownerA.tokens.accessToken, tenantA.slug, '?search=vip', 'search ticket types');
  assert(searchResult.items.some((item) => item.slug === vip.slug), 'search should find vip ticket', searchResult.items);

  const publicFilter = await listTicketTypes(ownerA.tokens.accessToken, tenantA.slug, '?visibility=public', 'filter public tickets');
  assert(publicFilter.items.some((item) => item.slug === vip.slug), 'public filter should include vip', publicFilter.items);

  const eventFilter = await listTicketTypes(ownerA.tokens.accessToken, tenantA.slug, `?eventId=${event.id}`, 'filter by event');
  assert(eventFilter.items.length === 3, 'event filter should return all tenant event tickets', eventFilter.items);

  const refundableFilter = await listTicketTypes(ownerA.tokens.accessToken, tenantA.slug, '?isRefundable=true', 'filter refundable tickets');
  assert(refundableFilter.items.some((item) => item.slug === vip.slug), 'refundable filter should include vip', refundableFilter.items);

  const statusActiveBefore = await listTicketTypes(ownerA.tokens.accessToken, tenantA.slug, '?status=active', 'filter active tickets before transition');
  assert(statusActiveBefore.items.some((item) => item.slug === couple.slug), 'active filter should include couple ticket', statusActiveBefore.items);

  const vipActive = await updateTicketType(ownerA.tokens.accessToken, tenantA.slug, vip.slug, { status: 'active' }, 'activate vip ticket', getVip.updatedAt);
  assert(vipActive.status === 'active', 'vip should be active', vipActive);

  const staleVipUpdate = await request<ApiSuccess<TicketTypeRecord>>(`/ticket-types/${vip.slug}`, {
    method: 'PATCH',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: { status: 'paused', lastKnownUpdatedAt: getVip.updatedAt }
  });
  expectStaleRequest(staleVipUpdate, 'stale vip ticket update');

  const vipPaused = await updateTicketType(ownerA.tokens.accessToken, tenantA.slug, vip.slug, { status: 'paused' }, 'pause vip ticket', vipActive.updatedAt);
  assert(vipPaused.status === 'paused', 'vip should be paused', vipPaused);

  const vipSoldOut = await updateTicketType(ownerA.tokens.accessToken, tenantA.slug, vip.slug, { status: 'sold_out' }, 'sell out vip ticket', vipPaused.updatedAt);
  assert(vipSoldOut.status === 'sold_out', 'vip should be sold out', vipSoldOut);

  const coupleDeleted = await deleteTicketType(ownerA.tokens.accessToken, tenantA.slug, couple.slug, 'delete couple ticket', couple.updatedAt);
  assert(coupleDeleted.deletedAt !== null, 'deleted ticket should have deletedAt', coupleDeleted);

  const deletedLookup = await request<ApiSuccess<TicketTypeRecord>>(`/ticket-types/${couple.slug}`, {
    method: 'GET',
    headers: authHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  expectStatus(deletedLookup, [404], 'deleted ticket should not be retrievable');

  const postDeleteList = await listTicketTypes(ownerA.tokens.accessToken, tenantA.slug, '', 'list after delete');
  assert(!postDeleteList.items.some((item) => item.slug === couple.slug), 'soft-deleted ticket should be excluded from list', postDeleteList.items);

  const tenantBList = await listTicketTypes(ownerB.tokens.accessToken, tenantB.slug, '', 'tenant B empty list');
  assert(tenantBList.items.length === 0, 'tenant B should not see tenant A tickets', tenantBList.items);

  console.log('TICKET SMOKE TEST PASSED');
}

run().catch((error) => {
  console.error('TICKET SMOKE TEST FAILED');
  console.error(error);
  process.exit(1);
});

export {};
