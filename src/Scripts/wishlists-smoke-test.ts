import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

interface RequestResult {
  status: number;
  ok: boolean;
  data: any;
  raw: string;
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const extra = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${extra}`);
  }
}

async function request(path: string, options: RequestOptions = {}): Promise<RequestResult> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const raw = await response.text();
  let data: any = null;

  if (raw.trim().length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    raw
  };
}

async function signupUser(username: string) {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const payload = {
    username: `${username}_${ts}`,
    fullName: `${username} User`,
    email: `${username}_${ts}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+1250555${String(ts).slice(-4).padStart(4, '0')}`
  };
  const startRes = await request('/auth/signup/start', {
    method: 'POST',
    body: payload
  });
  assert(startRes.status === 201, `Signup start failed for ${username}`, startRes.data);
  const { verificationSessionId } = startRes.data.data;

  const verifyRes = await request('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });
  assert(verifyRes.status === 201, `Signup verify failed for ${username}`, verifyRes.data);
  return verifyRes.data.data;
}

async function run() {
  console.log('WISHLISTS SMOKE TEST STARTING...');

  const ownerAuth = await signupUser('wish_owner');

  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      name: `Wish Tenant ${Date.now()}`,
      description: 'Tenant for wishlist testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;

  const headers = {
    Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // Create venue first
  const venueRes = await request('/venues', {
    method: 'POST',
    headers,
    body: {
      name: 'Wish Venue',
      addressLine1: '123 Test St',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India'
    }
  });
  assert(venueRes.status === 201, 'Venue creation failed', venueRes.data);
  const venue = venueRes.data.data;

  // Create event first
  const eventRes = await request('/events', {
    method: 'POST',
    headers,
    body: {
      title: 'Wish Fest',
      venueId: venue.id,
      startDateTime: new Date(Date.now() + 86400000).toISOString(),
      endDateTime: new Date(Date.now() + 172800000).toISOString(),
      timezone: 'Asia/Kolkata'
    }
  });
  assert(eventRes.status === 201, 'Event creation failed', eventRes.data);
  const event = eventRes.data.data;

  // 1. ADD TO WISHLIST
  const addRes = await request(`/wishlists/events/${event.id}`, {
    method: 'POST',
    headers
  });
  assert(addRes.status === 201, 'Add to wishlist failed', addRes.data);

  // 2. GET USER WISHLIST
  const getRes = await request('/users/me/wishlist', { headers });
  assert(getRes.status === 200, 'Get wishlist failed', getRes.data);
  assert(getRes.data.data.length === 1, 'Length mismatch');
  assert(getRes.data.data[0].eventId === event.id, 'Event ID mismatch');

  // 3. GET TRENDING SAVED EVENTS
  const trendingRes = await request('/wishlists?limit=5', { headers });
  assert(trendingRes.status === 200, 'Get trending failed', trendingRes.data);
  assert(trendingRes.data.data.length === 1, 'Trending length mismatch');
  assert(trendingRes.data.data[0].eventId === event.id, 'Trending event ID mismatch');

  // 4. REMOVE FROM WISHLIST
  const deleteRes = await request(`/wishlists/events/${event.id}`, {
    method: 'DELETE',
    headers
  });
  assert(deleteRes.status === 200, 'Remove from wishlist failed', deleteRes.data);

  // 5. GET USER WISHLIST (SHOULD BE EMPTY)
  const getEmptyRes = await request('/users/me/wishlist', { headers });
  assert(getEmptyRes.status === 200, 'Get wishlist empty failed', getEmptyRes.data);
  assert(getEmptyRes.data.data.length === 0, 'Wishlist should be empty after deletion');

  console.log('WISHLISTS SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('WISHLISTS SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
