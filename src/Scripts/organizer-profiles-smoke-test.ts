import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

interface RequestResult<T> {
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
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

async function run() {
  console.log('ORGANIZER PROFILES SMOKE TEST STARTING...');

  const ts = Date.now();
  const ownerPayload = {
    username: `org_owner_${ts}`,
    fullName: 'Organizer Owner User',
    email: `org_owner_${ts}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+1650555${String(ts).slice(-4)}`
  };

  // 1. SIGNUP & LOGIN
  const startRes = await request<any>('/auth/signup/start', {
    method: 'POST',
    body: ownerPayload
  });
  assert(startRes.status === 201, 'Owner signup start failed', startRes.data);
  const { verificationSessionId } = startRes.data.data;

  const verifyRes = await request<any>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });
  assert(verifyRes.status === 201, 'Owner signup verify failed', verifyRes.data);
  const auth = verifyRes.data.data;
  const token = auth.tokens.accessToken;

  // 2. CREATE TENANT
  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      name: `Tenant Org ${ts}`,
      description: 'Test tenant for organizers'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-tenant-slug': tenant.slug
  };

  // 3. CREATE ORGANIZER
  const createRes = await request('/organizers', {
    method: 'POST',
    headers,
    body: {
      name: `Vibe Events ${ts}`,
      description: 'Leading concert producer in the region',
      socialLinks: [
        { platform: 'instagram', url: 'https://instagram.com/vibeevents' },
        { platform: 'twitter', url: 'https://twitter.com/vibeevents' }
      ]
    }
  });
  assert(createRes.status === 201, 'Create organizer failed', createRes.data);
  const organizer = createRes.data.data;
  assert(organizer.name === `Vibe Events ${ts}`, 'Name mismatch');
  assert(organizer.slug.startsWith(`vibe-events-${ts}`), 'Slug mismatch');

  // 4. GET BY SLUG
  const getRes = await request(`/organizers/${organizer.slug}`, { headers });
  assert(getRes.status === 200, 'Get organizer failed', getRes.data);
  assert(getRes.data.data.socialLinks.length === 2, 'Social links mismatch');

  // 5. UPDATE ORGANIZER (WITH OCC)
  const updateRes = await request(`/organizers/${organizer.slug}`, {
    method: 'PATCH',
    headers,
    body: {
      description: 'Updated organizer description',
      lastKnownUpdatedAt: organizer.updatedAt
    }
  });
  assert(updateRes.status === 200, 'Update organizer failed', updateRes.data);
  const updatedOrg = updateRes.data.data;

  // Stale request OCC check
  const staleUpdateRes = await request(`/organizers/${organizer.slug}`, {
    method: 'PATCH',
    headers,
    body: {
      description: 'Should fail',
      lastKnownUpdatedAt: organizer.updatedAt
    }
  });
  assert(staleUpdateRes.status === 409, 'OCC stale check failed, expected 409 status', staleUpdateRes.data);

  // 6. CREATE REVIEW
  const reviewRes = await request(`/organizers/${organizer.slug}/reviews`, {
    method: 'POST',
    headers,
    body: {
      rating: 5,
      comment: 'Excellent logistics and execution!'
    }
  });
  assert(reviewRes.status === 201, 'Review creation failed', reviewRes.data);

  // 7. GET ANALYTICS
  const analyticsRes = await request(`/organizers/${organizer.slug}/analytics`, { headers });
  assert(analyticsRes.status === 200, 'Get analytics failed', analyticsRes.data);
  assert(analyticsRes.data.data.averageRating === 5, 'Rating stats mismatch');
  assert(analyticsRes.data.data.totalReviews === 1, 'Review counts mismatch');

  // 8. DELETE
  const deleteRes = await request(`/organizers/${organizer.slug}`, {
    method: 'DELETE',
    headers,
    body: {
      lastKnownUpdatedAt: updatedOrg.updatedAt
    }
  });
  assert(deleteRes.status === 200, 'Delete organizer failed', deleteRes.data);

  console.log('ORGANIZER PROFILES SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('ORGANIZER PROFILES SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
