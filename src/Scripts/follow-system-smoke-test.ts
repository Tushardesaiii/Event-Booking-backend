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
    phoneNumber: `+1350555${String(ts).slice(-4).padStart(4, '0')}`
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
  console.log('FOLLOW SYSTEM SMOKE TEST STARTING...');

  const userA = await signupUser('user_a');
  const userB = await signupUser('user_b');

  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    body: {
      name: `Follow Tenant ${Date.now()}`,
      description: 'Tenant for follow system testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;

  // Add user B to tenant
  await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    body: {
      userId: userB.user.id,
      role: 'viewer'
    }
  });

  const headersA = {
    Authorization: `Bearer ${userA.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };
  const headersB = {
    Authorization: `Bearer ${userB.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // 1. FOLLOW USER
  const followUserRes = await request(`/users/${userB.user.id}/follow`, {
    method: 'POST',
    headers: headersA
  });
  assert(followUserRes.status === 201, 'Follow user failed', followUserRes.data);

  // 2. CHECK FOLLOWERS LIST
  const followersRes = await request(`/users/${userB.user.id}/followers`, { headers: headersB });
  assert(followersRes.status === 200, 'Get followers failed', followersRes.data);
  assert(followersRes.data.data.length === 1, 'Follower count mismatch');
  assert(followersRes.data.data[0].followerUserId === userA.user.id, 'Follower ID mismatch');

  // 3. CHECK FOLLOWING LIST
  const followingRes = await request(`/users/${userA.user.id}/following`, { headers: headersA });
  assert(followingRes.status === 200, 'Get following failed', followingRes.data);
  assert(followingRes.data.data.length === 1, 'Following count mismatch');
  assert(followingRes.data.data[0].followingUserId === userB.user.id, 'Following ID mismatch');

  // 4. UNFOLLOW USER
  const unfollowUserRes = await request(`/users/${userB.user.id}/follow`, {
    method: 'DELETE',
    headers: headersA
  });
  assert(unfollowUserRes.status === 200, 'Unfollow user failed', unfollowUserRes.data);

  // 5. CHECK FOLLOWERS (SHOULD BE EMPTY)
  const emptyFollowers = await request(`/users/${userB.user.id}/followers`, { headers: headersB });
  assert(emptyFollowers.status === 200, 'Get followers empty failed', emptyFollowers.data);
  assert(emptyFollowers.data.data.length === 0, 'Followers list should be empty');

  console.log('FOLLOW SYSTEM SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('FOLLOW SYSTEM SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
