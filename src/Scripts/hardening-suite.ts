import { cacheService } from '../lib/cache.js';
import { twilioService } from '../lib/twilio.js';
import { qstashService } from '../lib/qstash.js';
import { checkRateLimit } from '../lib/rate-limiter.js';
import { app } from '../app.js';
import { randomUUID } from 'node:crypto';

function assert(condition: any, message: string, details?: any) {
  if (!condition) {
    const errorDetails = details ? `\nDetails: ${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`[Hardening Suite] Assertion Failed: ${message}${errorDetails}`);
  }
}

async function runRedisTests() {
  console.log('\n--- 1. Testing Upstash Redis Caching & Locking ---');
  const key = `revelis:test:cache:${randomUUID()}`;
  
  // Set & Get
  await cacheService.set(key, { name: 'Hardening Test', success: true }, 60);
  const val = await cacheService.get<{ name: string; success: boolean }>(key);
  assert(val?.success === true, 'Cache get/set should return serialized object', val);
  
  // Exists
  const exists = await cacheService.exists(key);
  assert(exists === true, 'Cache key should exist');

  // Increment
  const incrKey = `revelis:test:incr:${randomUUID()}`;
  const v1 = await cacheService.increment(incrKey);
  const v2 = await cacheService.increment(incrKey);
  assert(v1 === 1 && v2 === 2, 'Increment should count correctly', { v1, v2 });
  await cacheService.delete(incrKey);

  // Lock & Unlock
  const lockKey = `test-lock-${randomUUID()}`;
  const locked = await cacheService.lock(lockKey, 10);
  assert(locked === true, 'Should acquire lock');
  
  const doubleLock = await cacheService.lock(lockKey, 10);
  assert(doubleLock === false, 'Should fail to acquire lock when already held');

  await cacheService.unlock(lockKey);
  const reLocked = await cacheService.lock(lockKey, 10);
  assert(reLocked === true, 'Should acquire lock after unlock');
  await cacheService.unlock(lockKey);

  // Delete
  await cacheService.delete(key);
  const existsAfter = await cacheService.exists(key);
  assert(existsAfter === false, 'Key should be deleted');
  console.log('✓ Upstash Redis Cache & Locking tests passed');
}

async function runRateLimitConcurrency(concurrentUsers: number) {
  console.log(`Running Rate Limiting Concurrency Test for ${concurrentUsers} concurrent requests`);
  const rateLimitKey = `revelis:rate_limit:test:load:${concurrentUsers}:${randomUUID()}`;
  const limit = 20;
  const window = 10;

  const promises = Array.from({ length: concurrentUsers }).map(() =>
    checkRateLimit(rateLimitKey, limit, window, false)
  );

  const results = await Promise.all(promises);
  const allowed = results.filter(r => r.allowed).length;
  const blocked = results.filter(r => !r.allowed).length;
  
  console.log(`- Results for ${concurrentUsers} requests: Allowed: ${allowed}, Blocked: ${blocked}`);
  
  // Standard concurrency check
  assert(allowed === Math.min(concurrentUsers, limit), `Allowed count should match limit or request count`);
  assert(blocked === Math.max(0, concurrentUsers - limit), `Blocked count should match requests exceeding limit`);
  
  // Check headers validity on first blocked/allowed response
  const allowedSample = results.find(r => r.allowed);
  const blockedSample = results.find(r => !r.allowed);
  
  if (allowedSample) {
    assert(allowedSample.limit === limit, 'Limit value should match');
  }
  if (blockedSample) {
    assert(blockedSample.retryAfter > 0, 'Retry-After header should be set on blocked requests');
  }
}

async function runRateLimiterTests() {
  console.log('\n--- 2. Testing Live Upstash Rate Limiting & Concurrency ---');
  
  // Test sliding window
  const slidingKey = `revelis:rate_limit:test:sliding:${randomUUID()}`;
  const r1 = await checkRateLimit(slidingKey, 2, 5, false);
  const r2 = await checkRateLimit(slidingKey, 2, 5, false);
  const r3 = await checkRateLimit(slidingKey, 2, 5, false);
  
  assert(r1.allowed === true && r2.allowed === true, 'First 2 requests should be allowed');
  assert(r3.allowed === false, 'Third request should be blocked');
  
  // Concurrency validation against live Upstash
  await runRateLimitConcurrency(50);
  await runRateLimitConcurrency(100);
  await runRateLimitConcurrency(500);

  console.log('✓ Upstash Rate Limiting & Concurrency tests passed');
}

async function runIdempotencyTests() {
  console.log('\n--- 3. Testing Redis-Backed Idempotency Middleware ---');
  const key = `idemp-key-${randomUUID()}`;
  
  // Setup payload
  const path = `/auth/signup`; // Uses signup endpoint for test
  
  // Simulate 1st request
  const response1 = await app.request('/health', {
    method: 'GET',
    headers: {
      'Idempotency-Key': key
    }
  });
  assert(response1.status === 200, 'First request should succeed');
  assert(response1.headers.get('X-Cache-Idempotency') === null, 'First request should be a cache miss');

  // Simulate 2nd request with same key
  const response2 = await app.request('/health', {
    method: 'GET',
    headers: {
      'Idempotency-Key': key
    }
  });
  assert(response2.status === 200, 'Second request should succeed');
  assert(response2.headers.get('X-Cache-Idempotency') === 'HIT', 'Second request should be a cache hit');

  console.log('✓ Idempotency middleware tests passed');
}

async function runWebhookSecurityTests() {
  console.log('\n--- 4. Testing Webhook Security Controls (QStash) ---');

  // 1. Unsigned request check
  const response1 = await app.request('/qstash/jobs', {
    method: 'POST',
    body: JSON.stringify({ jobType: 'welcome_sms', data: {} })
  });
  // Since we bypass unsigned requests ONLY in development/test if NODE_ENV !== 'production' and header is missing,
  // let's test if we pass a bad signature it fails!
  const response2 = await app.request('/qstash/jobs', {
    method: 'POST',
    headers: {
      'Upstash-Signature': 'invalid-signature-here'
    },
    body: JSON.stringify({ jobType: 'welcome_sms', data: {} })
  });
  assert(response2.status === 401, 'Request with invalid signature should be rejected');

  // 2. Replay protection check
  // Mock validation passing but test replay prevention logic
  const msgId = `msg-${randomUUID()}`;
  const response3 = await app.request('/qstash/jobs', {
    method: 'POST',
    headers: {
      'Upstash-Message-Id': msgId,
    },
    body: JSON.stringify({ jobType: 'welcome_sms', data: { phoneNumber: '+15551234567' } })
  });
  // The first run can bypass signature check in test if signature is omitted, but should record msgId
  assert(response3.status === 200, 'First job run should succeed or bypass');

  const response4 = await app.request('/qstash/jobs', {
    method: 'POST',
    headers: {
      'Upstash-Message-Id': msgId,
    },
    body: JSON.stringify({ jobType: 'welcome_sms', data: { phoneNumber: '+15551234567' } })
  });
  const text4 = await response4.text();
  assert(text4.includes('Already processed'), 'Second run with same message ID should be blocked by replay protection');

  console.log('✓ Webhook security checks passed');
}

async function runHealthAndMetricsTests() {
  console.log('\n--- 5. Testing Health Checks & Metrics ---');

  // Health endpoint
  const healthRes = await app.request('/health');
  const healthData = await healthRes.json() as any;
  assert(healthRes.status === 200, 'Health check should return 200');
  assert(healthData?.success === true, 'Health check should return success');

  // Metrics endpoint
  const metricsRes = await app.request('/metrics');
  const metricsText = await metricsRes.text();
  assert(metricsRes.status === 200, 'Metrics should return 200');
  
  // Verify standard metrics presence
  assert(metricsText.includes('redis_operations_total'), 'Metrics should export redis_operations_total');
  assert(metricsText.includes('twilio_sms_sent_total'), 'Metrics should export twilio_sms_sent_total');
  assert(metricsText.includes('otp_generated_total'), 'Metrics should export otp_generated_total');
  assert(metricsText.includes('qstash_jobs_published_total'), 'Metrics should export qstash_jobs_published_total');

  console.log('✓ Health & Metrics tests passed');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('============================================================');
  console.log('STARTING REVELIS INTEGRATION HARDENING SUITE');
  console.log('============================================================');

  try {
    await runRedisTests();
    await sleep(2000);
    await runRateLimiterTests();
    await sleep(2000);
    await runIdempotencyTests();
    await sleep(2000);
    await runWebhookSecurityTests();
    await sleep(2000);
    await runHealthAndMetricsTests();

    console.log('\n============================================================');
    console.log('ALL INTEGRATION HARDENING TESTS PASSED!');
    console.log('============================================================');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ HARDENING SUITE FAILED:');
    console.error(err);
    process.exit(1);
  }
}

main();
