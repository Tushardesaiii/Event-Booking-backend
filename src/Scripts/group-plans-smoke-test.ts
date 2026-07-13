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
    phoneNumber: `+1750555${String(ts).slice(-4).padStart(4, '0')}`
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
  console.log('GROUP PLANS SMOKE TEST STARTING...');

  // 1. SIGNUP USERS
  const ownerAuth = await signupUser('grp_owner');
  const memberAuth = await signupUser('grp_member');

  // 2. CREATE TENANT
  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      name: `Group Tenant ${Date.now()}`,
      description: 'Tenant for group planning testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;

  // Add the second user to tenant so they can interact in the same tenant context
  const memberAddRes = await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      userId: memberAuth.user.id,
      role: 'viewer'
    }
  });
  assert(memberAddRes.status === 201, 'Member invite to tenant failed', memberAddRes.data);

  const ownerHeaders = {
    Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };
  const memberHeaders = {
    Authorization: `Bearer ${memberAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // 3. CREATE GROUP PLAN
  const createRes = await request('/group-plans', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      name: 'Weekend Concert Outing',
      description: 'Planning concert night with college friends'
    }
  });
  assert(createRes.status === 201, 'Group plan creation failed', createRes.data);
  const plan = createRes.data.data;

  // 4. GET GROUP PLAN MEMBERS
  const membersRes = await request(`/group-plans/${plan.id}/members`, { headers: ownerHeaders });
  assert(membersRes.status === 200, 'Get members failed', membersRes.data);
  assert(membersRes.data.data.length === 1, 'Members length mismatch (should have creator)');

  // 5. INVITE MEMBER
  const inviteRes = await request(`/group-plans/${plan.id}/invite`, {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      inviteeUserId: memberAuth.user.id
    }
  });
  assert(inviteRes.status === 201, 'Invite member failed', inviteRes.data);
  const invite = inviteRes.data.data;

  // 6. ACCEPT INVITE
  const acceptRes = await request(`/group-plans/invites/${invite.id}/accept`, {
    method: 'POST',
    headers: memberHeaders
  });
  assert(acceptRes.status === 200, 'Accept invite failed', acceptRes.data);

  // 7. GET GROUP PLAN DETAILS
  const detailRes = await request(`/group-plans/${plan.id}`, { headers: ownerHeaders });
  assert(detailRes.status === 200, 'Get details failed', detailRes.data);
  assert(detailRes.data.data.members.length === 2, 'Members count should be 2 after accept');

  // 8. ACTIVITY LOG
  const activityRes = await request(`/group-plans/${plan.id}/activity`, { headers: ownerHeaders });
  assert(activityRes.status === 200, 'Get activity failed', activityRes.data);
  assert(activityRes.data.data.length >= 2, 'Activity counts mismatch');

  // 9. LEAVE GROUP
  const leaveRes = await request(`/group-plans/${plan.id}/leave`, {
    method: 'POST',
    headers: memberHeaders
  });
  assert(leaveRes.status === 200, 'Leave group failed', leaveRes.data);

  console.log('GROUP PLANS SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('GROUP PLANS SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
