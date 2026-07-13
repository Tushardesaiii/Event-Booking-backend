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
  raw: string;
}

interface AuthResult {
  user: { id: string; email: string; username: string; };
  tokens: { accessToken: string; refreshToken: string; };
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

interface EventSeriesRecord {
  id: string;
  slug: string;
  title: string;
}

interface EventCategoryRecord {
  id: string;
  slug: string;
  name: string;
}

interface EventTagRecord {
  id: string;
  slug: string;
  name: string;
}

interface EventRecord {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'cancelled' | 'completed' | 'archived';
  visibility: 'public' | 'private' | 'unlisted';
  isFeatured: boolean;
  publishedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  tags: Array<{ id: string; slug: string; name: string; }>;
}

function log(message: string) {
  console.log(message);
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function getHeaders(accessToken?: string, tenantSlug?: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(tenantSlug ? { 'x-tenant-slug': tenantSlug } : {})
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${BASE_URL}${path}`, options);
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
    log(`${response.status} ${options.method ?? 'GET'} ${path}`);
    if (raw.trim()) {
      log(raw);
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    raw
  };
}

function extractSuccess<T>(result: RequestResult<ApiSuccess<T>>, label: string): ApiSuccess<T> {
  assert(result.ok, `${label} failed`, result.data ?? result.raw);
  const payload = result.data as ApiSuccess<T> | null;
  assert(payload?.success === true, `${label} returned invalid payload`, result.data ?? result.raw);
  return payload;
}

function expectStatus(result: RequestResult<unknown>, expected: number[], label: string) {
  assert(expected.includes(result.status), `${label} expected status ${expected.join(',')} got ${result.status}`, result.data ?? result.raw);
}

function expectStaleRequest(result: RequestResult<unknown>, label: string) {
  expectStatus(result, [409], label);
  const body = result.data as ApiError | null;
  assert(body?.error?.code === 'STALE_REQUEST', `${label} expected STALE_REQUEST`, result.data ?? result.raw);
}

async function signupUser(prefix: string) {
  const ts = Date.now();
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const payload = {
    username: `${prefix}_${ts}`,
    fullName: `${prefix} user`,
    email: `${prefix}_${ts}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+91999911${phoneSuffix}`
  };

  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  const { verificationSessionId } = extractSuccess(startResponse, `${prefix} signup start`).data;

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      verificationSessionId,
      code: '123456'
    })
  });

  const body = extractSuccess(verifyResponse, `${prefix} signup verify`);
  return body.data;
}

async function createTenant(accessToken: string, name: string) {
  const result = await request<ApiSuccess<TenantRecord>>('/tenants', {
    method: 'POST',
    headers: getHeaders(accessToken),
    body: JSON.stringify({ name, description: `Tenant for ${name}` })
  });

  return extractSuccess(result, `create tenant ${name}`).data;
}

async function createVenue(accessToken: string, tenantSlug: string, suffix: string) {
  const result = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: getHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      name: `Navratri Arena ${suffix}`,
      addressLine1: 'SG Highway',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      capacity: 12000
    })
  });

  return extractSuccess(result, 'create venue').data;
}

async function run() {
  log('EVENT SMOKE TEST START');
  log(`Base URL: ${BASE_URL}`);

  const ownerA = await signupUser('event_owner_a');
  const managerA = await signupUser('event_manager_a');
  const ownerB = await signupUser('event_owner_b');

  const tenantA = await createTenant(ownerA.tokens.accessToken, 'Ahmedabad Navratri Ops');
  const tenantB = await createTenant(ownerB.tokens.accessToken, 'Surat Cultural Org');

  const addManager = await request<ApiSuccess<{ id: string }>>(`/tenants/${tenantA.slug}/members`, {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken),
    body: JSON.stringify({ userId: managerA.user.id, role: 'viewer' })
  });
  extractSuccess(addManager, 'add manager as viewer');

  const venue = await createVenue(ownerA.tokens.accessToken, tenantA.slug, 'A');

  const createSeries = await request<ApiSuccess<EventSeriesRecord>>('/event-series', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      title: 'Royal Garba Nights 2026',
      description: 'Three-night Navratri flagship in Ahmedabad',
      timezone: 'Asia/Kolkata',
      startDateTime: '2026-10-15T13:30:00.000Z',
      endDateTime: '2026-10-18T05:30:00.000Z'
    })
  });
  const series = extractSuccess(createSeries, 'create event series').data;

  const createCategory = await request<ApiSuccess<EventCategoryRecord>>('/event-categories', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      name: 'Navratri',
      description: 'Navratri and Garba festival events'
    })
  });
  const category = extractSuccess(createCategory, 'create event category').data;

  const createCategory2 = await request<ApiSuccess<EventCategoryRecord>>('/event-categories', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      name: 'Concert',
      description: 'Concert and music events'
    })
  });
  const category2 = extractSuccess(createCategory2, 'create second event category').data;

  const createTag1 = await request<ApiSuccess<EventTagRecord>>('/event-tags', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({ name: 'Live Music', description: 'Live orchestra and folk singers' })
  });
  const tag1 = extractSuccess(createTag1, 'create event tag live music').data;

  const createTag2 = await request<ApiSuccess<EventTagRecord>>('/event-tags', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({ name: 'Family Friendly', description: 'Suitable for all age groups' })
  });
  const tag2 = extractSuccess(createTag2, 'create event tag family friendly').data;

  const createTag3 = await request<ApiSuccess<EventTagRecord>>('/event-tags', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({ name: 'Afterparty', description: 'Late-night event experiences' })
  });
  const tag3 = extractSuccess(createTag3, 'create event tag afterparty').data;

  const unauthorizedCreate = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: getHeaders(managerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      title: 'Should Not Create',
      startDateTime: '2026-10-15T14:00:00.000Z',
      endDateTime: '2026-10-15T20:00:00.000Z',
      timezone: 'Asia/Kolkata'
    })
  });
  expectStatus(unauthorizedCreate, [403], 'RBAC protection on event create');

  const createEvent = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      title: 'Royal Garba Night 2026',
      shortDescription: 'Premium Garba night with celebrity artists',
      description: 'Royal Garba Night 2026 at SG Highway arena in Ahmedabad.',
      startDateTime: '2026-10-16T14:00:00.000Z',
      endDateTime: '2026-10-16T20:00:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'draft',
      visibility: 'public',
      venueId: venue.id,
      categoryId: category.id,
      eventSeriesId: series.id,
      maxCapacity: 10000,
      isFeatured: true,
      metaTitle: 'Royal Garba Night 2026 Ahmedabad',
      metaDescription: 'Book Royal Garba Night passes in Ahmedabad',
      termsAndConditions: 'No outside food allowed.',
      cancellationPolicy: 'No refund within 24h of event.',
      tagIds: [tag1.id, tag2.id]
    })
  });
  const event = extractSuccess(createEvent, 'create event').data;
  assert(event.slug.length > 0, 'event slug should be present', event);
  assert(event.tags.length === 2, 'event should have 2 tags', event);

  const createEvent2 = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      title: 'Concert Night 2026',
      shortDescription: 'Music-forward festival concert',
      description: 'A second event to verify multi-category and multi-tag discovery filters.',
      startDateTime: '2026-10-17T14:00:00.000Z',
      endDateTime: '2026-10-17T20:00:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId: venue.id,
      categoryId: category2.id,
      isFeatured: false,
      tagIds: [tag3.id]
    })
  });
  const event2 = extractSuccess(createEvent2, 'create second event').data;
  assert(event2.tags.length === 1, 'second event should have 1 tag', event2);

  const crossTenantRead = await request<ApiSuccess<EventRecord>>(`/events/${event.slug}`, {
    method: 'GET',
    headers: getHeaders(ownerB.tokens.accessToken, tenantA.slug)
  });
  expectStatus(crossTenantRead, [403], 'tenant isolation read');

  const listEvents = await request<ApiSuccess<EventRecord[]>>('/events?page=1&limit=20&search=garba', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const listPayload = extractSuccess(listEvents, 'list events with search');
  const listMeta = listPayload.meta;
  assert(Array.isArray(listPayload.data), 'list events should return array', listPayload);
  assert((listMeta?.total ?? 0) >= 1, 'list events should include total count', listPayload);

  const filteredByCity = await request<ApiSuccess<EventRecord[]>>('/events?city=Ahmedabad', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(filteredByCity, 'filter events by city');

  const filteredByStatus = await request<ApiSuccess<EventRecord[]>>('/events?status=draft', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(filteredByStatus, 'filter events by status');

  const filteredByCategory = await request<ApiSuccess<EventRecord[]>>(`/events?categoryId=${category.id}`, {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(filteredByCategory, 'filter events by category');

  const filteredBySlugCategoriesAndTags = await request<ApiSuccess<EventRecord[]>>(
    `/events?categories=${category.slug},${category2.slug}&tags=${tag1.slug},${tag3.slug}`,
    {
      method: 'GET',
      headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
    }
  );
  const slugFilterPayload = extractSuccess(filteredBySlugCategoriesAndTags, 'filter events by categories and tags');
  assert((slugFilterPayload.data?.length ?? 0) >= 2, 'combined category/tag filters should return both events', slugFilterPayload);

  const invalidWindowCombination = await request<ApiSuccess<EventRecord[]>>('/events?upcoming=true&past=true', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  expectStatus(invalidWindowCombination, [400], 'invalid window filter combination');

  const filteredByVenue = await request<ApiSuccess<EventRecord[]>>(`/events?venueId=${venue.id}`, {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(filteredByVenue, 'filter events by venue');

  const filteredByDateRange = await request<ApiSuccess<EventRecord[]>>('/events?startDate=2026-10-16&endDate=2026-10-17', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(filteredByDateRange, 'filter events by date range');

  const filteredByFeatured = await request<ApiSuccess<EventRecord[]>>('/events?isFeatured=true&featuredFirst=true&sortBy=startDateTime&sortOrder=asc', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(filteredByFeatured, 'filter events by isFeatured and sorting');

  const filteredByPopularitySort = await request<ApiSuccess<EventRecord[]>>('/events?sortBy=popularity&sortOrder=desc', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(filteredByPopularitySort, 'filter events by popularity sort');

  const getEvent = await request<ApiSuccess<EventRecord>>(`/events/${event.slug}`, {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const fetchedEvent = extractSuccess(getEvent, 'get event by slug').data;
  assert(fetchedEvent.id === event.id, 'fetched event id mismatch', fetchedEvent);

  const updateEventPublished = await request<ApiSuccess<EventRecord>>(`/events/${event.slug}`, {
    method: 'PATCH',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      status: 'published',
      shortDescription: 'Published Garba night update',
      lastKnownUpdatedAt: fetchedEvent.updatedAt
    })
  });
  const publishedEvent = extractSuccess(updateEventPublished, 'publish event').data;
  assert(publishedEvent.status === 'published', 'event should be published', publishedEvent);
  assert(!!publishedEvent.publishedAt, 'publishedAt should be populated', publishedEvent);

  const staleEventUpdate = await request<ApiSuccess<EventRecord>>(`/events/${event.slug}`, {
    method: 'PATCH',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({
      status: 'cancelled',
      lastKnownUpdatedAt: fetchedEvent.updatedAt
    })
  });
  expectStaleRequest(staleEventUpdate, 'stale event update');

  const updateEventCancelled = await request<ApiSuccess<EventRecord>>(`/events/${event.slug}`, {
    method: 'PATCH',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({ status: 'cancelled', lastKnownUpdatedAt: publishedEvent.updatedAt })
  });
  const cancelledEvent = extractSuccess(updateEventCancelled, 'cancel event').data;
  assert(cancelledEvent.status === 'cancelled', 'event should be cancelled', cancelledEvent);

  const listSeries = await request<ApiSuccess<EventSeriesRecord[]>>('/event-series', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const seriesPayload = extractSuccess(listSeries, 'list event series').data;
  assert(seriesPayload.some((item) => item.slug === series.slug), 'created series should be listed', seriesPayload);

  const getSeries = await request<ApiSuccess<EventSeriesRecord>>(`/event-series/${series.slug}`, {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  extractSuccess(getSeries, 'get event series by slug');

  const listCategories = await request<ApiSuccess<EventCategoryRecord[]>>('/event-categories', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const categoriesPayload = extractSuccess(listCategories, 'list event categories').data;
  assert(categoriesPayload.some((item) => item.slug === category.slug), 'created category should be listed', categoriesPayload);

  const listTags = await request<ApiSuccess<EventTagRecord[]>>('/event-tags', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const tagsPayload = extractSuccess(listTags, 'list event tags').data;
  assert(tagsPayload.length >= 2, 'expected at least two tags', tagsPayload);

  const deleteEvent = await request<ApiSuccess<EventRecord>>(`/events/${event.slug}`, {
    method: 'DELETE',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug),
    body: JSON.stringify({ lastKnownUpdatedAt: cancelledEvent.updatedAt })
  });
  const deletedEvent = extractSuccess(deleteEvent, 'delete event').data;
  assert(deletedEvent.deletedAt !== null, 'deleted event should have deletedAt', deletedEvent);

  const getDeletedEvent = await request<ApiSuccess<EventRecord>>(`/events/${event.slug}`, {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  expectStatus(getDeletedEvent, [404], 'deleted event should not be retrievable');

  const postDeleteList = await request<ApiSuccess<EventRecord[]>>('/events', {
    method: 'GET',
    headers: getHeaders(ownerA.tokens.accessToken, tenantA.slug)
  });
  const postDeletePayload = extractSuccess(postDeleteList, 'list events after delete').data;
  assert(!postDeletePayload.some((item) => item.id === event.id), 'soft-deleted event should be excluded from list', postDeletePayload);

  const tenantBSeriesList = await request<ApiSuccess<EventSeriesRecord[]>>('/event-series', {
    method: 'GET',
    headers: getHeaders(ownerB.tokens.accessToken, tenantB.slug)
  });
  const tenantBPayload = extractSuccess(tenantBSeriesList, 'tenant B series list').data;
  assert(tenantBPayload.every((item) => item.slug !== series.slug), 'tenant B must not see tenant A series', tenantBPayload);

  log('EVENT SMOKE TEST PASSED');
}

run().catch((error) => {
  console.error('EVENT SMOKE TEST FAILED');
  console.error(error);
  process.exit(1);
});

export {};
