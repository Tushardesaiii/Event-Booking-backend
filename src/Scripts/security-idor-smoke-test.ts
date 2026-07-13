import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

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
  console.log('SECURITY IDOR SMOKE TEST STARTING...');
  const ts = Date.now();

  // 1. SETUP TENANT A (The Victim)
  const userA = {
    username: `victim_${ts}`,
    fullName: 'Victim User',
    email: `victim_${ts}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+1555111${String(ts).slice(-4)}`
  };

  const signupA = await request('/auth/signup', { method: 'POST', body: userA });
  assert(signupA.status === 201, 'User A signup failed');
  const tokenA = signupA.data.data.tokens.accessToken;

  const tenantARes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: { name: `Tenant A ${ts}`, description: 'Victim Tenant' }
  });
  assert(tenantARes.status === 201, 'Tenant A creation failed');
  const tenantA = tenantARes.data.data.slug;
  const headersA = { Authorization: `Bearer ${tokenA}`, 'x-tenant-slug': tenantA };

  // Create Organizer in Tenant A
  const orgARes = await request('/organizers', {
    method: 'POST',
    headers: headersA,
    body: { name: `Org A ${ts}`, description: 'Victim Organizer' }
  });
  assert(orgARes.status === 201, 'Org A creation failed');
  const orgASlug = orgARes.data.data.slug;

  // Create Review in Tenant A
  const reviewARes = await request(`/organizers/${orgASlug}/reviews`, {
    method: 'POST',
    headers: headersA,
    body: { rating: 5, comment: 'Great job A!' }
  });
  assert(reviewARes.status === 201, 'Review A creation failed');
  const reviewIdA = reviewARes.data.data.id;


  // 2. SETUP TENANT B (The Attacker)
  const userB = {
    username: `attacker_${ts}`,
    fullName: 'Attacker User',
    email: `attacker_${ts}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+1555222${String(ts).slice(-4)}`
  };

  const signupB = await request('/auth/signup', { method: 'POST', body: userB });
  assert(signupB.status === 201, 'User B signup failed');
  const tokenB = signupB.data.data.tokens.accessToken;

  const tenantBRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: { name: `Tenant B ${ts}`, description: 'Attacker Tenant' }
  });
  assert(tenantBRes.status === 201, 'Tenant B creation failed');
  const tenantB = tenantBRes.data.data.slug;
  const headersB = { Authorization: `Bearer ${tokenB}`, 'x-tenant-slug': tenantB };


  // 3. THE ATTACK: Tenant B tries to modify Review A
  // This should be blocked by our Priority 1 patch because the review belongs to an organizer in Tenant A,
  // but the attacker is executing the request under Tenant B's context.
  
  const attackRes = await request(`/organizers/reviews/${reviewIdA}`, {
    method: 'PATCH',
    headers: headersB,
    body: { rating: 1, comment: 'HACKED!' }
  });

  // Since we query by both reviewId AND check the joined organizer's tenantId, 
  // it should return 404 (Not Found) rather than updating it or returning 403.
  assert(
    attackRes.status === 404, 
    `ATTACK FAILED: Expected 404 Not Found, but got ${attackRes.status}`, 
    attackRes.data
  );

  console.log('SECURITY IDOR SMOKE TEST PASSED: Cross-tenant isolation successfully prevented unauthorized modification.');
}

run().catch((err) => {
  console.error('SECURITY IDOR SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
