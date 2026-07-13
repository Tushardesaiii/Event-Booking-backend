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
    phoneNumber: `+1550555${String(ts).slice(-4).padStart(4, '0')}`
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
  console.log('NOTIFICATIONS SMOKE TEST STARTING...');

  const ownerAuth = await signupUser('notif_owner');

  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      name: `Notif Tenant ${Date.now()}`,
      description: 'Tenant for notifications testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;

  const headers = {
    Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // 1. GET PREFERENCES (SHOULD GENERATE DEFAULTS)
  const getPrefs = await request('/notification-preferences', { headers });
  assert(getPrefs.status === 200, 'Get preferences failed', getPrefs.data);
  assert(getPrefs.data.data.emailEnabled === true, 'Default preference should be true');

  // 2. UPDATE PREFERENCES
  const updatePrefs = await request('/notification-preferences', {
    method: 'PATCH',
    headers,
    body: {
      inAppEnabled: true,
      emailEnabled: false
    }
  });
  assert(updatePrefs.status === 200, 'Update preferences failed', updatePrefs.data);
  assert(updatePrefs.data.data.emailEnabled === false, 'Preference wasn’t updated');

  // Create a Group Plan and invite member to trigger notification
  const memberAuth = await signupUser('notif_member');
  await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      userId: memberAuth.user.id,
      role: 'viewer'
    }
  });

  const memberHeaders = {
    Authorization: `Bearer ${memberAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  const grpRes = await request('/group-plans', {
    method: 'POST',
    headers,
    body: { name: 'Party Group' }
  });
  const plan = grpRes.data.data;

  // Invite member -> triggers notification
  await request(`/group-plans/${plan.id}/invite`, {
    method: 'POST',
    headers,
    body: { inviteeUserId: memberAuth.user.id }
  });

  // 3. LIST NOTIFICATIONS FOR MEMBER
  const listNotifs = await request('/notifications?isRead=false', { headers: memberHeaders });
  assert(listNotifs.status === 200, 'List notifications failed', listNotifs.data);
  assert(listNotifs.data.data.length === 1, 'In-app notification should have been generated');
  const notif = listNotifs.data.data[0];

  // 4. MARK NOTIFICATION AS READ
  const markRead = await request(`/notifications/${notif.id}/read`, {
    method: 'PATCH',
    headers: memberHeaders
  });
  assert(markRead.status === 200, 'Mark read failed', markRead.data);

  // 5. VERIFY ISREAD FILTER (SHOULD BE EMPTY FOR UNREAD)
  const listUnread = await request('/notifications?isRead=false', { headers: memberHeaders });
  assert(listUnread.status === 200, 'List unread failed', listUnread.data);
  assert(listUnread.data.data.length === 0, 'No unread notifications should be left');

  console.log('NOTIFICATIONS SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('NOTIFICATIONS SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
