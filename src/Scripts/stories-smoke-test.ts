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
    phoneNumber: `+1450555${String(ts).slice(-4).padStart(4, '0')}`
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
  console.log('STORIES SMOKE TEST STARTING...');

  const ownerAuth = await signupUser('story_owner');

  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      name: `Story Tenant ${Date.now()}`,
      description: 'Tenant for stories testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;

  const headers = {
    Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // 1. POST STORY
  const createRes = await request('/stories', {
    method: 'POST',
    headers,
    body: {
      ownerType: 'user',
      ownerId: ownerAuth.user.id,
      mediaUrl: 'https://images.example.com/story.jpg',
      mediaType: 'image',
      caption: 'Having fun at the concert!'
    }
  });
  assert(createRes.status === 201, 'Post story failed', createRes.data);
  const story = createRes.data.data;

  // 2. VIEW STORY
  const viewRes = await request(`/stories/${story.id}/view`, {
    method: 'POST',
    headers
  });
  assert(viewRes.status === 201, 'View story failed', viewRes.data);

  // 3. REACT TO STORY
  const reactRes = await request(`/stories/${story.id}/react`, {
    method: 'POST',
    headers,
    body: {
      reactionType: '👍'
    }
  });
  assert(reactRes.status === 201, 'React story failed', reactRes.data);

  // 4. REPLY TO STORY
  const replyRes = await request(`/stories/${story.id}/reply`, {
    method: 'POST',
    headers,
    body: {
      message: 'Looks awesome!'
    }
  });
  assert(replyRes.status === 201, 'Reply story failed', replyRes.data);

  // 5. GET STORY DETAILS
  const detailsRes = await request(`/stories/${story.id}`, { headers });
  assert(detailsRes.status === 200, 'Get story details failed', detailsRes.data);
  assert(detailsRes.data.data.viewsCount === 1, 'Views mismatch');
  assert(detailsRes.data.data.reactions.length === 1, 'Reactions mismatch');
  assert(detailsRes.data.data.replies.length === 1, 'Replies mismatch');

  // 6. DELETE STORY
  const deleteRes = await request(`/stories/${story.id}`, {
    method: 'DELETE',
    headers
  });
  assert(deleteRes.status === 200, 'Delete story failed', deleteRes.data);

  console.log('STORIES SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('STORIES SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
