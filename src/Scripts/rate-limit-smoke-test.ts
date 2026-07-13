import { app } from '../app.js';
import { checkRateLimit, getClientIp } from '../lib/rate-limiter.js';
import { getRedisStatus, redis } from '../lib/redis.js';
import { rateLimitMetrics } from '../middlewares/rate-limit.middleware.js';
import { env } from '../config/env.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function run() {
  console.log('============================================================');
  console.log('RUNNING RATE LIMITER SMOKE TESTS');
  console.log('============================================================');

  const redisAvailable = getRedisStatus();
  console.log(`Redis connected: ${redisAvailable}`);

  // ==========================================
  // 1. IP RESOLUTION TESTS (Security Tests)
  // ==========================================
  console.log('\n--- 1. IP Resolution / Spoofing Protection ---');
  
  const cfMock = {
    req: {
      header: (name: string) => {
        if (name === 'cf-connecting-ip') return '203.0.113.195';
        if (name === 'x-forwarded-for') return '198.51.100.1';
        return undefined;
      }
    }
  };
  assert(getClientIp(cfMock) === '203.0.113.195', 'Should trust cf-connecting-ip over x-forwarded-for');

  const xffMock = {
    req: {
      header: (name: string) => {
        if (name === 'x-forwarded-for') return '198.51.100.1, 198.51.100.2';
        return undefined;
      }
    }
  };
  assert(getClientIp(xffMock) === '198.51.100.1', 'Should resolve leftmost IP in XFF chain');

  console.log('IP resolution tests passed!');

  // ==========================================
  // 2. CORE RATE LIMITING TESTS (Unit Tests)
  // ==========================================
  if (redisAvailable && redis) {
    console.log('\n--- 2. Core Rate Limiting (ZSET Sliding Window) ---');
    const testKey = `test:rate_limit:${Date.now()}`;
    const limit = 3;
    const window = 5; // 5 seconds

    // 1st request
    const r1 = await checkRateLimit(testKey, limit, window, false);
    console.log('Req 1:', r1);
    assert(r1.allowed === true, 'Req 1 should be allowed');
    assert(r1.remaining === 2, 'Req 1 remaining should be 2');

    // 2nd request
    const r2 = await checkRateLimit(testKey, limit, window, false);
    assert(r2.allowed === true, 'Req 2 should be allowed');
    assert(r2.remaining === 1, 'Req 2 remaining should be 1');

    // 3rd request
    const r3 = await checkRateLimit(testKey, limit, window, false);
    assert(r3.allowed === true, 'Req 3 should be allowed');
    assert(r3.remaining === 0, 'Req 3 remaining should be 0');

    // 4th request (Blocked)
    const r4 = await checkRateLimit(testKey, limit, window, false);
    console.log('Req 4 (Blocked):', r4);
    assert(r4.allowed === false, 'Req 4 should be blocked');
    assert(r4.remaining === 0, 'Req 4 remaining should be 0');
    assert(r4.retryAfter > 0, 'Req 4 retryAfter should be > 0');

    // Clean up
    await redis.del(testKey);
    console.log('Core rate limiting unit tests passed!');

    // ==========================================
    // 3. CONCURRENCY TESTS
    // ==========================================
    console.log('\n--- 3. Concurrency Tests ---');
    const concKey = `test:conc:${Date.now()}`;
    const concLimit = 10;
    const concWindow = 10;
    
    // Send 15 concurrent requests
    const promises = Array.from({ length: 15 }).map(() =>
      checkRateLimit(concKey, concLimit, concWindow, false)
    );
    const results = await Promise.all(promises);
    
    const allowedCount = results.filter(r => r.allowed).length;
    const blockedCount = results.filter(r => !r.allowed).length;
    console.log(`Concurrent requests: Allowed: ${allowedCount}, Blocked: ${blockedCount}`);
    
    assert(allowedCount === concLimit, `Exactly ${concLimit} requests should be allowed`);
    assert(blockedCount === 5, 'Exactly 5 requests should be blocked');
    
    await redis.del(concKey);
    console.log('Concurrency tests passed!');
  } else {
    console.log('\n--- Skipping Core & Concurrency tests (Redis offline) ---');
  }

  // ==========================================
  // 4. GRACEFUL DEGRADATION TESTS
  // ==========================================
  console.log('\n--- 4. Graceful Degradation Tests (Fail-Open/Closed) ---');
  
  // Import cacheService to mock it offline
  const { cacheService } = await import('../lib/cache.js');
  const originalGetClient = cacheService.getClient;
  const originalGetBreakerState = cacheService.getBreakerState;

  // Mock offline state
  cacheService.getClient = () => null;
  cacheService.getBreakerState = () => 'OPEN';
  
  try {
    // Fail open (e.g. low risk route)
    const openFallback = await checkRateLimit('test:fallback:open', 10, 60, false);
    console.log('Fail-Open Fallback Result:', openFallback);
    assert(openFallback.allowed === true, 'Fail-open fallback should allow request');
    assert(openFallback.remaining === 10, 'Fail-open remaining should match limit');

    // Fail closed (e.g. auth route)
    const closedFallback = await checkRateLimit('test:fallback:closed', 10, 60, true);
    console.log('Fail-Closed Fallback Result:', closedFallback);
    assert(closedFallback.allowed === false, 'Fail-closed fallback should block request');
    assert(closedFallback.remaining === 0, 'Fail-closed remaining should be 0');
    assert(closedFallback.retryAfter === 60, 'Fail-closed retryAfter should match window duration');
  } finally {
    // Restore original methods
    cacheService.getClient = originalGetClient;
    cacheService.getBreakerState = originalGetBreakerState;
  }

  console.log('Graceful degradation tests passed!');

  // ==========================================
  // 5. INTEGRATION & HEADER TESTS (Hono App)
  // ==========================================
  console.log('\n--- 5. Integration and Response Headers ---');
  
  const res = await app.request('/health');
  console.log('GET /health status:', res.status);
  console.log('RateLimit-Limit Header:', res.headers.get('RateLimit-Limit'));
  console.log('RateLimit-Remaining Header:', res.headers.get('RateLimit-Remaining'));
  console.log('RateLimit-Reset Header:', res.headers.get('RateLimit-Reset'));
  
  assert(res.status === 200, '/health should return 200');
  assert(res.headers.has('RateLimit-Limit'), 'Should return RateLimit-Limit header');
  assert(res.headers.has('RateLimit-Remaining'), 'Should return RateLimit-Remaining header');
  assert(res.headers.has('RateLimit-Reset'), 'Should return RateLimit-Reset header');

  // ==========================================
  // 6. METRICS & PROMETHEUS SCRAPE
  // ==========================================
  console.log('\n--- 6. Observability Metrics Endpoint ---');
  
  const metricRes = await app.request('/metrics');
  const metricText = await metricRes.text();
  console.log('Metrics Endpoint Scrape Output:\n', metricText);
  
  assert(metricRes.status === 200, '/metrics should return 200');
  assert(metricText.includes('total_rate_limit_hits'), 'Metrics should export total_rate_limit_hits');
  assert(metricText.includes('total_rate_limit_blocks'), 'Metrics should export total_rate_limit_blocks');
  
  console.log('Metrics observability tests passed!');

  if (redis) {
    redis.disconnect();
  }

  console.log('\n============================================================');
  console.log('ALL RATE LIMITER SMOKE TESTS COMPLETED SUCCESSFULLY!');
  console.log('============================================================');
}

run().catch(err => {
  console.error('\nSMOKE TESTS FAILED:');
  console.error(err);
  process.exit(1);
});
