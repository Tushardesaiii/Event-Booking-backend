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
    phoneNumber: `+1950555${String(ts).slice(-4).padStart(4, '0')}`
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
  console.log('EVENT POLLS SMOKE TEST STARTING...');

  const ownerAuth = await signupUser('poll_owner');

  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      name: `Poll Tenant ${Date.now()}`,
      description: 'Tenant for polls testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;

  const headers = {
    Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // Create Group Plan first
  const grpRes = await request('/group-plans', {
    method: 'POST',
    headers,
    body: {
      name: 'Poll Plan'
    }
  });
  assert(grpRes.status === 201, 'Group plan creation failed', grpRes.data);
  const plan = grpRes.data.data;

  // 1. CREATE POLL
  const pollRes = await request('/polls', {
    method: 'POST',
    headers,
    body: {
      groupPlanId: plan.id,
      question: 'Where should we go for lunch?',
      options: [
        { optionText: 'Italian Cafe' },
        { optionText: 'Mexican Restaurant' }
      ]
    }
  });
  assert(pollRes.status === 201, 'Poll creation failed', pollRes.data);
  const poll = pollRes.data.data;

  const option1 = poll.options[0].id;
  const option2 = poll.options[1].id;

  // 2. VOTE ON POLL
  const voteRes = await request(`/polls/${poll.id}/vote`, {
    method: 'POST',
    headers,
    body: {
      optionIds: [option1]
    }
  });
  assert(voteRes.status === 200, 'Casting vote failed', voteRes.data);
  assert(voteRes.data.data.options[0].votesCount === 1, 'Vote count mismatch');

  // Verify duplicate voting prevention (changes vote to option2)
  const revoteRes = await request(`/polls/${poll.id}/vote`, {
    method: 'POST',
    headers,
    body: {
      optionIds: [option2]
    }
  });
  assert(revoteRes.status === 200, 'Re-casting vote failed', revoteRes.data);
  assert(revoteRes.data.data.options[0].votesCount === 0, 'Previous vote wasn’t cleared');
  assert(revoteRes.data.data.options[1].votesCount === 1, 'New vote wasn’t counted');

  // 3. CLOSE POLL (WITH OCC)
  const closeRes = await request(`/polls/${poll.id}`, {
    method: 'PATCH',
    headers,
    body: {
      isClosed: true,
      lastKnownUpdatedAt: poll.updatedAt
    }
  });
  assert(closeRes.status === 200, 'Closing poll failed', closeRes.data);

  // 4. VERIFY BLOCKED VOTE AFTER CLOSE
  const postCloseVote = await request(`/polls/${poll.id}/vote`, {
    method: 'POST',
    headers,
    body: {
      optionIds: [option1]
    }
  });
  assert(postCloseVote.status === 400, 'Voting on closed poll should fail');

  console.log('EVENT POLLS SMOKE TEST PASSED');
}

run().catch((err) => {
  console.error('EVENT POLLS SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
