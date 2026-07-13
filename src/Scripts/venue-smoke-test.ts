const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const KEEP_DATA = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_KEEP_DATA || 'false');
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

type JsonRecord = Record<string, unknown>;

interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

interface ApiErrorBody {
  code: string;
  details?: unknown;
}

interface ApiError {
  success: false;
  message: string;
  error: ApiErrorBody;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  avatarAssetId: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthResult {
  user: AuthUser;
  session: {
    id: string;
    expiresAt: string;
  };
  tokens: AuthTokens;
}

interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoAssetId: string | null;
  coverAssetId: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  isVerified: boolean;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface VenueRecord {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  latitude: string | null;
  longitude: string | null;
  capacity: number | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  coverAssetId: string | null;
  isActive: boolean;
  isVerified: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface TenantMembershipRecord {
  id: string;
  tenantId: string;
  userId: string;
  role: 'owner' | 'admin' | 'manager' | 'staff' | 'viewer';
  invitedByUserId: string | null;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

interface RequestResult<T> {
  status: number;
  ok: boolean;
  data: T | ApiError | null;
  meta?: PaginationMeta;
  raw: string;
}

const color = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m'
};

function paint(value: string, code: string) {
  return `${code}${value}${color.reset}`;
}

function banner(title: string) {
  console.log(`\n${paint('============================================================', color.dim)}`);
  console.log(paint(title, color.bold));
  console.log(paint('============================================================', color.dim));
}

function logPass(message: string) {
  console.log(`${paint('✔', color.green)} ${message}`);
}

function logFail(message: string) {
  console.error(`${paint('✖', color.red)} ${message}`);
}

function logInfo(message: string) {
  console.log(`${paint('•', color.cyan)} ${message}`);
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const extra = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${extra}`);
  }
}

function headersToObject(headers: HeadersInit | undefined) {
  return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headersToObject(options.headers)
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
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
    console.log(paint(`HTTP ${response.status} ${path}`, color.dim));
    if (raw.trim().length > 0) {
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

function authHeaders(accessToken: string, tenantSlug?: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(tenantSlug ? { 'x-tenant-slug': tenantSlug } : {})
  };
}

function extractSuccess<T>(response: RequestResult<ApiSuccess<T>>, stepName: string): T {
  assert(response.ok, `${stepName} failed`, response.data ?? response.raw);
  const payload = response.data as ApiSuccess<T> | null;
  assert(payload && payload.success === true, `${stepName} returned an unexpected response shape`, response.data ?? response.raw);
  return payload.data;
}

function extractError(response: RequestResult<unknown>) {
  return response.data as ApiError | null;
}

function expectStatus(response: RequestResult<unknown>, statuses: number[], stepName: string) {
  assert(statuses.includes(response.status), `${stepName} expected status ${statuses.join(', ')} but got ${response.status}`, {
    body: response.data ?? response.raw
  });
}

function ensureVenueShape(venue: VenueRecord, context: string) {
  assert(typeof venue.id === 'string' && venue.id.length > 0, `${context}: missing id`, venue);
  assert(typeof venue.tenantId === 'string' && venue.tenantId.length > 0, `${context}: missing tenantId`, venue);
  assert(typeof venue.name === 'string' && venue.name.length > 0, `${context}: missing name`, venue);
  assert(typeof venue.slug === 'string' && venue.slug.length > 0, `${context}: missing slug`, venue);
  assert(typeof venue.addressLine1 === 'string' && venue.addressLine1.length > 0, `${context}: missing addressLine1`, venue);
  assert(typeof venue.city === 'string' && venue.city.length > 0, `${context}: missing city`, venue);
  assert(typeof venue.state === 'string' && venue.state.length > 0, `${context}: missing state`, venue);
  assert(typeof venue.country === 'string' && venue.country.length > 0, `${context}: missing country`, venue);
  assert(typeof venue.isActive === 'boolean', `${context}: missing isActive`, venue);
  assert(typeof venue.isVerified === 'boolean', `${context}: missing isVerified`, venue);
  assert(typeof venue.createdAt === 'string' && venue.createdAt.length > 0, `${context}: missing createdAt`, venue);
  assert(typeof venue.updatedAt === 'string' && venue.updatedAt.length > 0, `${context}: missing updatedAt`, venue);
}

function ensurePaginatedVenues(response: RequestResult<ApiSuccess<VenueRecord[]>>, stepName: string) {
  const payload = extractSuccess(response, stepName);
  assert(Array.isArray(payload), `${stepName}: expected items array`, payload);
  const meta = response.meta;
  assert(meta && typeof meta.total === 'number', `${stepName}: missing pagination meta`, response.data ?? response.raw);
  return { items: payload, meta };
}

function ensureTenant(response: RequestResult<ApiSuccess<TenantRecord>>, stepName: string) {
  const tenant = extractSuccess(response, stepName);
  assert(typeof tenant.slug === 'string' && tenant.slug.length > 0, `${stepName}: missing slug`, tenant);
  return tenant;
}

function ensureAuthResult(response: RequestResult<ApiSuccess<AuthResult>>, stepName: string) {
  const result = extractSuccess(response, stepName);
  assert(result.user?.id, `${stepName}: missing user`, result);
  assert(result.tokens?.accessToken, `${stepName}: missing access token`, result);
  assert(result.tokens?.refreshToken, `${stepName}: missing refresh token`, result);
  return result;
}

async function signupUser(prefix: string, roleLabel: string) {
  const timestamp = Date.now();
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const payload = {
    username: `${prefix}_${timestamp}`,
    fullName: `${roleLabel} User`,
    email: `${prefix}_${timestamp}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+91999911${phoneSuffix}`
  };

  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: payload
  });
  const { verificationSessionId } = extractSuccess(startResponse, `${roleLabel} signup start`);

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });

  const result = ensureAuthResult(verifyResponse, `${roleLabel} signup`);
  return { response: verifyResponse, payload, result };
}

async function loginUser(email: string, password: string, roleLabel: string) {
  const response = await request<ApiSuccess<AuthResult>>('/auth/login', {
    method: 'POST',
    body: {
      email,
      password
    }
  });

  const result = ensureAuthResult(response, `${roleLabel} login`);
  return { response, result };
}

async function createTenant(accessToken: string, name: string, description: string) {
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: {
      name,
      description
    }
  });

  const tenant = ensureTenant(response, 'tenant creation');
  return { response, tenant };
}

async function addTenantMember(accessToken: string, tenantSlug: string, input: { userId: string; role: TenantMembershipRecord['role'] }) {
  const response = await request<ApiSuccess<TenantMembershipRecord>>(`/tenants/${tenantSlug}/members`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: input
  });

  const membership = extractSuccess(response, 'tenant member creation');
  assert(membership.id, 'tenant member creation: missing membership id', membership);
  return { response, membership };
}

async function createVenue(accessToken: string, tenantSlug: string, payload: JsonRecord, label: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: payload
  });

  const venue = extractSuccess(response, label);
  ensureVenueShape(venue, label);
  return { response, venue };
}

async function listVenues(accessToken: string, tenantSlug: string, query: string, label: string) {
  const response = await request<ApiSuccess<VenueRecord[]>>(`/venues${query}`, {
    method: 'GET',
    headers: authHeaders(accessToken, tenantSlug)
  });

  const payload = ensurePaginatedVenues(response, label);
  payload.items.forEach((venue, index) => ensureVenueShape(venue, `${label} item ${index + 1}`));
  return { response, payload };
}

async function getVenue(accessToken: string, tenantSlug: string, slug: string, label: string) {
  const response = await request<ApiSuccess<VenueRecord>>(`/venues/${slug}`, {
    method: 'GET',
    headers: authHeaders(accessToken, tenantSlug)
  });

  const venue = extractSuccess(response, label);
  ensureVenueShape(venue, label);
  return { response, venue };
}

async function updateVenue(accessToken: string, tenantSlug: string, slug: string, body: JsonRecord, label: string) {
  const response = await request<ApiSuccess<VenueRecord>>(`/venues/${slug}`, {
    method: 'PATCH',
    headers: authHeaders(accessToken, tenantSlug),
    body
  });

  const venue = extractSuccess(response, label);
  ensureVenueShape(venue, label);
  return { response, venue };
}

async function deleteVenue(accessToken: string, tenantSlug: string, slug: string, label: string, lastKnownUpdatedAt: string) {
  const response = await request<ApiSuccess<VenueRecord>>(`/venues/${slug}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken, tenantSlug),
    body: { lastKnownUpdatedAt }
  });

  const venue = extractSuccess(response, label);
  ensureVenueShape(venue, label);
  return { response, venue };
}

async function expectStaleRequest(response: RequestResult<unknown>, label: string) {
  expectStatus(response, [409], label);
  const error = extractError(response);
  assert(error?.error?.code === 'STALE_REQUEST', `${label}: expected STALE_REQUEST`, response.data ?? response.raw);
}

async function logout(accessToken: string, refreshToken: string, label: string) {
  const response = await request<ApiSuccess<{ success: boolean }>>('/auth/logout', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: { refreshToken }
  });

  expectStatus(response, [200], label);
  return response;
}

async function expectForbidden(response: RequestResult<unknown>, label: string) {
  expectStatus(response, [403], label);
  const error = extractError(response);
  assert(error?.success === false || response.status === 403, `${label}: expected a forbidden response`, response.data ?? response.raw);
}

async function expectValidationFailure(response: RequestResult<unknown>, label: string) {
  expectStatus(response, [400], label);
  const error = extractError(response);
  assert(error?.success === false || response.status === 400, `${label}: expected a validation failure`, response.data ?? response.raw);
}

async function run() {
  banner('VENUE SMOKE TEST START');
  logInfo(`Base URL: ${BASE_URL}`);

  const createdTenants: Array<{ slug: string; accessToken: string; refreshToken: string; label: string; updatedAt: string }> = [];
  const createdUsers: Array<{ accessToken: string; refreshToken: string; label: string }> = [];

  try {
    banner('1) Health Check');
    const health = await request<ApiSuccess<{ status: string }>>('/health');
    expectStatus(health, [200], 'health check');
    logPass('Server reachable');

    banner('2) Signup and Login Owner');
    const ownerSignup = await signupUser('owner', 'Owner');
    expectStatus(ownerSignup.response, [201], 'owner signup');
    logPass('Owner signup successful');

    const ownerLogin = await loginUser(ownerSignup.payload.email, ownerSignup.payload.password, 'Owner');
    expectStatus(ownerLogin.response, [200], 'owner login');
    logPass('Owner login successful');

    const owner = {
      user: ownerLogin.result.user,
      accessToken: ownerLogin.result.tokens.accessToken,
      refreshToken: ownerLogin.result.tokens.refreshToken
    };
    createdUsers.push({ accessToken: owner.accessToken, refreshToken: owner.refreshToken, label: 'owner' });

    banner('3) Create Tenant A');
    const tenantAResult = await createTenant(owner.accessToken, 'Royal Garba Group', 'Primary Navratri and event operations tenant');
    expectStatus(tenantAResult.response, [201], 'tenant A creation');
    logPass('Tenant created');

    const tenantA = tenantAResult.tenant;
    createdTenants.push({ slug: tenantA.slug, accessToken: owner.accessToken, refreshToken: owner.refreshToken, label: 'tenant A', updatedAt: tenantA.updatedAt });
    assert(tenantA.name === 'Royal Garba Group', 'Tenant A name mismatch', tenantA);

    banner('4) Signup and Login Viewer');
    const viewerSignup = await signupUser('viewer', 'Viewer');
    expectStatus(viewerSignup.response, [201], 'viewer signup');
    logPass('Viewer signup successful');

    const viewerLogin = await loginUser(viewerSignup.payload.email, viewerSignup.payload.password, 'Viewer');
    expectStatus(viewerLogin.response, [200], 'viewer login');
    logPass('Viewer login successful');

    const viewer = {
      user: viewerLogin.result.user,
      accessToken: viewerLogin.result.tokens.accessToken,
      refreshToken: viewerLogin.result.tokens.refreshToken
    };
    createdUsers.push({ accessToken: viewer.accessToken, refreshToken: viewer.refreshToken, label: 'viewer' });

    banner('5) Grant Viewer Membership');
    const viewerMembershipResult = await addTenantMember(owner.accessToken, tenantA.slug, {
      userId: viewer.user.id,
      role: 'viewer'
    });
    expectStatus(viewerMembershipResult.response, [201], 'viewer membership creation');
    logPass('Viewer role assigned');

    banner('6) Create Multiple Venues');
    const venueInputs = [
      {
        name: 'GMDC Garba Ground',
        description: 'Large-scale Garba ground near the core event district.',
        addressLine1: 'GMDC Ground Road',
        addressLine2: 'Near Vastrapur Lake',
        landmark: 'GMDC',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        postalCode: '380015',
        latitude: 23.0339,
        longitude: 72.5293,
        capacity: 25000,
        contactEmail: 'ground@royalgarba.example.com',
        contactPhone: '+91-98765-40001',
        website: 'https://venues.example.com/gmdc-garba-ground',
        isActive: true,
        isVerified: true
      },
      {
        name: 'Karnavati Club Arena',
        description: 'Premium club venue for ticketed seasonal evenings and private gatherings.',
        addressLine1: 'S G Highway',
        addressLine2: 'Prahlad Nagar Extension',
        landmark: 'Karnavati Club',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        postalCode: '380051',
        latitude: 23.0209,
        longitude: 72.5121,
        capacity: 4500,
        contactEmail: 'arena@royalgarba.example.com',
        contactPhone: '+91-98765-40002',
        website: 'https://venues.example.com/karnavati-club-arena',
        isActive: true,
        isVerified: true
      },
      {
        name: 'Riverfront Event Ground',
        description: 'Open-air ground designed for large cultural productions and concerts.',
        addressLine1: 'Sabarmati Riverfront',
        addressLine2: 'Event Zone A',
        landmark: 'Riverfront',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        postalCode: '380006',
        latitude: 23.0439,
        longitude: 72.5808,
        capacity: 18000,
        contactEmail: 'riverfront@royalgarba.example.com',
        contactPhone: '+91-98765-40003',
        website: 'https://venues.example.com/riverfront-event-ground',
        isActive: true,
        isVerified: false
      },
      {
        name: 'Tagore Hall Auditorium',
        description: 'Indoor auditorium for college festivals, rehearsals, and intimate shows.',
        addressLine1: 'Tagore Hall Road',
        addressLine2: 'Law Garden',
        landmark: 'Tagore Hall',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        postalCode: '380009',
        latitude: 23.0225,
        longitude: 72.5714,
        capacity: 2200,
        contactEmail: 'auditorium@royalgarba.example.com',
        contactPhone: '+91-98765-40004',
        website: 'https://venues.example.com/tagore-hall-auditorium',
        isActive: true,
        isVerified: false
      },
      {
        name: 'GMDC Garba Ground',
        description: 'Duplicate-name venue to validate slug uniqueness within the same tenant.',
        addressLine1: 'Sector 1 Road',
        addressLine2: 'North Expansion',
        landmark: 'GMDC Annex',
        city: 'Gandhinagar',
        state: 'Gujarat',
        country: 'India',
        postalCode: '382010',
        latitude: 23.2156,
        longitude: 72.6369,
        capacity: 12000,
        contactEmail: 'annex@royalgarba.example.com',
        contactPhone: '+91-98765-40005',
        website: 'https://venues.example.com/gmdc-garba-ground-annex',
        isActive: true,
        isVerified: true
      }
    ];

    const createdVenues: VenueRecord[] = [];
    for (const venueInput of venueInputs) {
      const result = await createVenue(owner.accessToken, tenantA.slug, venueInput, `venue creation: ${venueInput.name}`);
      const slugBase = venueInput.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      assert(result.venue.slug.startsWith(slugBase), `slug generation failed for ${venueInput.name}`, result.venue);
      createdVenues.push(result.venue);
    }

    logPass('Venue creation validated');

    banner('7) List Venues');
    const listPage1 = await listVenues(owner.accessToken, tenantA.slug, '?page=1&limit=2&sortBy=createdAt&sortOrder=desc', 'venue list page 1');
    assert(listPage1.payload.meta.total === 5, 'Venue list total count mismatch', listPage1.payload.meta);
    assert(listPage1.payload.items.length === 2, 'Venue list page 1 count mismatch', listPage1.payload);
    assert(listPage1.payload.meta.hasNextPage === true, 'Venue list page 1 should have next page', listPage1.payload.meta);

    const listPage2 = await listVenues(owner.accessToken, tenantA.slug, '?page=2&limit=2&sortBy=createdAt&sortOrder=desc', 'venue list page 2');
    assert(listPage2.payload.items.length === 2, 'Venue list page 2 count mismatch', listPage2.payload);
    assert(listPage2.payload.meta.total === 5, 'Venue list page 2 total mismatch', listPage2.payload.meta);

    const listPage3 = await listVenues(owner.accessToken, tenantA.slug, '?page=3&limit=2&sortBy=createdAt&sortOrder=desc', 'venue list page 3');
    assert(listPage3.payload.items.length === 1, 'Venue list page 3 count mismatch', listPage3.payload);
    assert(listPage3.payload.meta.hasNextPage === false, 'Venue list page 3 should not have next page', listPage3.payload.meta);
    logPass('Pagination and tenant scoping passed');

    banner('8) Search and Filters');
    const searchGarba = await listVenues(owner.accessToken, tenantA.slug, '?search=garba', 'venue search');
    assert(searchGarba.payload.items.length >= 2, 'Venue search should return garba venues', searchGarba.payload);

    const ahmedabadVenues = await listVenues(owner.accessToken, tenantA.slug, '?city=Ahmedabad', 'venue city filter');
    assert(ahmedabadVenues.payload.items.length === 4, 'City filter should return only Ahmedabad venues', ahmedabadVenues.payload);

    const activeVenues = await listVenues(owner.accessToken, tenantA.slug, '?isActive=true', 'venue active filter');
    assert(activeVenues.payload.items.length === 5, 'Active filter should include all active venues before delete', activeVenues.payload);
    logPass('Venue search and filters passed');

    banner('9) Get Venue By Slug');
    const primaryVenue = createdVenues[0];
    const fetchedVenue = await getVenue(owner.accessToken, tenantA.slug, primaryVenue.slug, 'venue get by slug');
    assert(fetchedVenue.venue.id === primaryVenue.id, 'Get by slug returned the wrong venue', fetchedVenue.venue);
    assert(fetchedVenue.venue.tenantId === tenantA.id, 'Venue tenant ownership mismatch', fetchedVenue.venue);
    logPass('Venue retrieval passed');

    banner('10) Update Venue');
    const beforeUpdate = fetchedVenue.venue;
    const updatedVenue = await updateVenue(owner.accessToken, tenantA.slug, primaryVenue.slug, {
      name: 'GMDC Garba Ground Updated',
      description: 'Updated for the 2026 Navratri season with improved ticketing and staff lanes.',
      capacity: 27000,
      contactPhone: '+91-98765-49999',
      lastKnownUpdatedAt: beforeUpdate.updatedAt
    }, 'venue update');

    assert(updatedVenue.venue.slug === beforeUpdate.slug, 'Venue slug should remain stable on update', updatedVenue.venue);
    assert(updatedVenue.venue.updatedAt !== beforeUpdate.updatedAt, 'Venue updatedAt should change on update', {
      beforeUpdate: beforeUpdate.updatedAt,
      afterUpdate: updatedVenue.venue.updatedAt
    });
    assert(updatedVenue.venue.capacity === 27000, 'Venue capacity update did not persist', updatedVenue.venue);

    const staleUpdateAttempt = await request(`/venues/${primaryVenue.slug}`, {
      method: 'PATCH',
      headers: authHeaders(owner.accessToken, tenantA.slug),
      body: {
        description: 'Stale venue update should fail',
        lastKnownUpdatedAt: beforeUpdate.updatedAt
      }
    });
    await expectStaleRequest(staleUpdateAttempt, 'stale venue update');
    logPass('Venue update passed');

    banner('11) RBAC Validation');
    const viewerCreateAttempt = await request('/venues', {
      method: 'POST',
      headers: authHeaders(viewer.accessToken, tenantA.slug),
      body: {
        name: 'Viewer Forbidden Venue',
        addressLine1: 'Viewer Road',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India'
      }
    });
    await expectForbidden(viewerCreateAttempt, 'viewer create venue');

    const viewerUpdateAttempt = await request(`/venues/${primaryVenue.slug}`, {
      method: 'PATCH',
      headers: authHeaders(viewer.accessToken, tenantA.slug),
      body: { description: 'Viewer should not be able to update this.', lastKnownUpdatedAt: beforeUpdate.updatedAt }
    });
    await expectForbidden(viewerUpdateAttempt, 'viewer update venue');

    const viewerDeleteAttempt = await request(`/venues/${primaryVenue.slug}`, {
      method: 'DELETE',
      headers: authHeaders(viewer.accessToken, tenantA.slug),
      body: { lastKnownUpdatedAt: beforeUpdate.updatedAt }
    });
    await expectForbidden(viewerDeleteAttempt, 'viewer delete venue');

    const viewerListAttempt = await listVenues(viewer.accessToken, tenantA.slug, '?limit=2', 'viewer venue list');
    assert(viewerListAttempt.payload.items.length >= 1, 'Viewer should be able to list tenant venues', viewerListAttempt.payload);
    logPass('RBAC protection passed');

    banner('12) Validation Failures');
    const invalidCoordinates = await request('/venues', {
      method: 'POST',
      headers: authHeaders(owner.accessToken, tenantA.slug),
      body: {
        name: 'Invalid Coordinates Venue',
        addressLine1: 'Invalid Road',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        latitude: 123.456,
        longitude: 181.1
      }
    });
    await expectValidationFailure(invalidCoordinates, 'invalid coordinates');

    const missingRequiredFields = await request('/venues', {
      method: 'POST',
      headers: authHeaders(owner.accessToken, tenantA.slug),
      body: {}
    });
    await expectValidationFailure(missingRequiredFields, 'missing required fields');

    const invalidCapacity = await request('/venues', {
      method: 'POST',
      headers: authHeaders(owner.accessToken, tenantA.slug),
      body: {
        name: 'Invalid Capacity Venue',
        addressLine1: 'Invalid Road',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        capacity: -1
      }
    });
    await expectValidationFailure(invalidCapacity, 'invalid capacity');

    const invalidEmail = await request('/venues', {
      method: 'POST',
      headers: authHeaders(owner.accessToken, tenantA.slug),
      body: {
        name: 'Invalid Email Venue',
        addressLine1: 'Invalid Road',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        contactEmail: 'not-an-email'
      }
    });
    await expectValidationFailure(invalidEmail, 'invalid email');

    const duplicateSlugOne = await createVenue(owner.accessToken, tenantA.slug, {
      name: 'Grand Navratri Pavilion',
      addressLine1: 'Pavilion Road',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      capacity: 15000,
      isActive: true,
      isVerified: false
    }, 'duplicate slug test - first venue');

    const duplicateSlugTwo = await createVenue(owner.accessToken, tenantA.slug, {
      name: 'Grand Navratri Pavilion',
      addressLine1: 'Pavilion Road 2',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      capacity: 9000,
      isActive: true,
      isVerified: false
    }, 'duplicate slug test - second venue');

    assert(duplicateSlugOne.venue.slug !== duplicateSlugTwo.venue.slug, 'Duplicate slug handling failed', {
      first: duplicateSlugOne.venue.slug,
      second: duplicateSlugTwo.venue.slug
    });
    logPass('Validation failures and duplicate slug handling passed');

    banner('13) Cross-Tenant Isolation');
    const ownerBSignup = await signupUser('ownerb', 'Owner B');
    expectStatus(ownerBSignup.response, [201], 'owner B signup');

    const ownerBLogin = await loginUser(ownerBSignup.payload.email, ownerBSignup.payload.password, 'Owner B');
    expectStatus(ownerBLogin.response, [200], 'owner B login');

    const ownerB = {
      user: ownerBLogin.result.user,
      accessToken: ownerBLogin.result.tokens.accessToken,
      refreshToken: ownerBLogin.result.tokens.refreshToken
    };
    createdUsers.push({ accessToken: ownerB.accessToken, refreshToken: ownerB.refreshToken, label: 'owner B' });

    const tenantBResult = await createTenant(ownerB.accessToken, 'Blue Beats Collective', 'Secondary tenant for isolation testing');
    expectStatus(tenantBResult.response, [201], 'tenant B creation');
    logPass('Second tenant created');

    const tenantB = tenantBResult.tenant;
    createdTenants.push({ slug: tenantB.slug, accessToken: ownerB.accessToken, refreshToken: ownerB.refreshToken, label: 'tenant B', updatedAt: tenantB.updatedAt });

    const tenantBVenue = await createVenue(ownerB.accessToken, tenantB.slug, {
      name: 'GMDC Garba Ground',
      description: 'Tenant B venue with a colliding base name to ensure isolation is tenant-scoped.',
      addressLine1: 'Iskcon Cross Road',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      capacity: 11000,
      isActive: true,
      isVerified: true
    }, 'tenant B venue creation');

    const crossTenantGet = await request(`/venues/${tenantBVenue.venue.slug}`, {
      method: 'GET',
      headers: authHeaders(owner.accessToken, tenantA.slug)
    });
    expectStatus(crossTenantGet, [404], 'cross-tenant get');

    const crossTenantUpdate = await request(`/venues/${tenantBVenue.venue.slug}`, {
      method: 'PATCH',
      headers: authHeaders(owner.accessToken, tenantA.slug),
      body: { description: 'Cross-tenant update attempt', lastKnownUpdatedAt: tenantBVenue.venue.updatedAt }
    });
    await expectStaleRequest(crossTenantUpdate, 'cross-tenant update');

    const crossTenantDelete = await request(`/venues/${tenantBVenue.venue.slug}`, {
      method: 'DELETE',
      headers: authHeaders(owner.accessToken, tenantA.slug),
      body: { lastKnownUpdatedAt: tenantBVenue.venue.updatedAt }
    });
    await expectStaleRequest(crossTenantDelete, 'cross-tenant delete');

    const directUnauthorizedTenantAccess = await request(`/venues/${tenantBVenue.venue.slug}`, {
      method: 'GET',
      headers: authHeaders(owner.accessToken, tenantB.slug)
    });
    await expectForbidden(directUnauthorizedTenantAccess, 'direct unauthorized tenant access');
    logPass('Cross-tenant isolation passed');

    banner('14) Soft Delete');
    const deleteTarget = duplicateSlugOne.venue;
    const deletedVenue = await deleteVenue(owner.accessToken, tenantA.slug, deleteTarget.slug, 'venue soft delete', deleteTarget.updatedAt);
    assert(deletedVenue.venue.deletedAt !== null, 'Soft delete should populate deletedAt', deletedVenue.venue);
    assert(deletedVenue.venue.isActive === false, 'Soft delete should deactivate the venue', deletedVenue.venue);

    const postDeleteList = await listVenues(owner.accessToken, tenantA.slug, '?isActive=true', 'post-delete active list');
    assert(!postDeleteList.payload.items.some((venue) => venue.slug === deleteTarget.slug), 'Deleted venue should be excluded from active lists', postDeleteList.payload);

    const postDeleteGet = await request(`/venues/${deleteTarget.slug}`, {
      method: 'GET',
      headers: authHeaders(owner.accessToken, tenantA.slug)
    });
    expectStatus(postDeleteGet, [404], 'get deleted venue');
    logPass('Soft delete passed');

    if (!KEEP_DATA) {
      banner('16) Cleanup');
      for (const tenant of createdTenants.slice().reverse()) {
        const response = await request<ApiSuccess<unknown>>(`/tenants/${tenant.slug}`, {
          method: 'DELETE',
          headers: authHeaders(tenant.accessToken),
          body: { confirmDelete: true, lastKnownUpdatedAt: tenant.updatedAt }
        });

        if (response.status === 401 || response.status === 403) {
          logInfo(`Skipping tenant cleanup for ${tenant.label} because the session is no longer active`);
          continue;
        }

        expectStatus(response, [200, 204], `cleanup delete ${tenant.label}`);
      }
      logPass('Best-effort cleanup completed');
    } else {
      logInfo('Cleanup skipped because SMOKE_TEST_KEEP_DATA is enabled');
    }

    banner('15) Logout Flow');
    await logout(owner.accessToken, owner.refreshToken, 'owner logout');
    await logout(viewer.accessToken, viewer.refreshToken, 'viewer logout');
    await logout(ownerB.accessToken, ownerB.refreshToken, 'owner B logout');

    const meAfterLogout = await request<ApiSuccess<unknown>>('/auth/me', {
      method: 'GET',
      headers: authHeaders(owner.accessToken)
    });
    expectStatus(meAfterLogout, [401], 'post-logout auth check');
    logPass('Logout flow passed');

    banner('Venue smoke test completed successfully');
  } catch (error) {
    logFail('Venue smoke test failed');
    if (error instanceof Error) {
      console.error(paint(error.message, color.red));
      if (error.stack) {
        console.error(paint(error.stack, color.dim));
      }
    } else {
      console.error(error);
    }
    process.exitCode = 1;
    throw error;
  }
}

run().catch(() => {
  process.exit(1);
});

export {};