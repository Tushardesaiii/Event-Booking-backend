import { sql } from './client.js';
import { cacheService } from '../lib/cache.js';
import { logger } from '../lib/logger.js';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkDatabase(retries: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await sql`SELECT 1`;
      if (Array.isArray(res) && res.length > 0) {
        logger.info('[Startup Wait] Database connection successful.');
        return true;
      }
    } catch (err: any) {
      logger.warn(`[Startup Wait] Database connection attempt ${i + 1}/${retries} failed: ${err.message}`);
    }
    await sleep(delayMs);
  }
  return false;
}

async function checkRedis(retries: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      // Attempt to communicate with Redis
      const healthy = await cacheService.exists('revelis:health_check_ping');
      if (typeof healthy === 'boolean') {
        logger.info('[Startup Wait] Redis connection successful.');
        return true;
      }
    } catch (err: any) {
      logger.warn(`[Startup Wait] Redis connection attempt ${i + 1}/${retries} failed: ${err.message}`);
    }
    await sleep(delayMs);
  }
  return false;
}

async function main() {
  logger.info('[Startup Wait] Starting services readiness check...');
  const dbHealthy = await checkDatabase(30, 1000);
  if (!dbHealthy) {
    logger.error('[Startup Wait] Database check failed permanently.');
    process.exit(1);
  }

  const redisHealthy = await checkRedis(30, 1000);
  if (!redisHealthy) {
    logger.error('[Startup Wait] Redis check failed permanently.');
    process.exit(1);
  }

  logger.info('[Startup Wait] All backend dependencies are healthy and ready.');
  // Cleanly close connection pools
  await sql.end();
  await cacheService.close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('[Startup Wait] Wait script crashed:', err);
  process.exit(1);
});
