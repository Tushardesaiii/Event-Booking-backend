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
    phoneNumber: `+1850555${String(ts).slice(-4).padStart(4, '0')}`
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
  console.log('GROUP CHAT SMOKE TEST STARTING...');

  const ownerAuth = await signupUser('chat_owner');

  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      name: `Chat Tenant ${Date.now()}`,
      description: 'Tenant for chat testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;

  const headers = {
    Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // Group Plan creation first (needed for rooms)
  const grpRes = await request('/group-plans', {
    method: 'POST',
    headers,
    body: {
      name: 'Chat Room Plan'
    }
  });
  assert(grpRes.status === 201, 'Group plan creation failed', grpRes.data);
  const plan = grpRes.data.data;

  // 1. CREATE ROOM
  const roomRes = await request('/group-chat/rooms', {
    method: 'POST',
    headers,
    body: {
      groupPlanId: plan.id,
      name: 'Main Lounge',
      description: 'Lounge for discussion'
    }
  });
  assert(roomRes.status === 201, 'Room creation failed', roomRes.data);
  const room = roomRes.data.data;

  // 2. SEND MESSAGE WITH ATTACHMENTS
  const msgRes = await request(`/group-chat/rooms/${room.id}/messages`, {
    method: 'POST',
    headers,
    body: {
      message: 'Hey friends, check out this map!',
      attachments: [
        { fileUrl: 'https://images.example.com/map.png', fileType: 'image', fileName: 'map.png', fileSize: 1024 }
      ]
    }
  });
  assert(msgRes.status === 201, 'Send message failed', msgRes.data);
  const message = msgRes.data.data;
  assert(message.attachments.length === 1, 'Attachment wasn’t sent');

  // 3. EDIT MESSAGE
  const editRes = await request(`/group-chat/messages/${message.id}`, {
    method: 'PATCH',
    headers,
    body: {
      message: 'Hey friends, check out this updated map!'
    }
  });
  assert(editRes.status === 200, 'Edit message failed', editRes.data);

  // 4. REACT TO MESSAGE
  const reactRes = await request(`/group-chat/messages/${message.id}/reactions`, {
    method: 'POST',
    headers,
    body: {
      reaction: '🔥'
    }
  });
  assert(reactRes.status === 201, 'Reaction failed', reactRes.data);

  // 5. GET MESSAGES LIST (PAGINATED)
  const listRes = await request(`/group-chat/rooms/${room.id}/messages?page=1&limit=10`, { headers });
  assert(listRes.status === 200, 'Get messages failed', listRes.data);
  assert(listRes.data.data.length === 1, 'Count mismatch');
  assert(listRes.data.data[0].message === 'Hey friends, check out this updated map!', 'Message wasn’t updated');

  // 6. DELETE MESSAGE
  const deleteRes = await request(`/group-chat/messages/${message.id}`, {
    method: 'DELETE',
    headers
  });
  assert(deleteRes.status === 200, 'Delete message failed', deleteRes.data);

  console.log('GROUP CHAT SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('GROUP CHAT SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
