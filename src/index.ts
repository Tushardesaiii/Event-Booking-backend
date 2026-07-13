import { performance } from 'node:perf_hooks';
const startTimestamp = performance.now();

// 1. Initialize OpenTelemetry tracing (must be first)
import './lib/otel.js';

// 2. Load configurations and schemas
import { env } from './config/env.js';
const configLoadTime = performance.now() - startTimestamp;

import { serve } from '@hono/node-server';
import { app } from './app.js';
import { injectVibesWebSocket } from './modules/vibes/ws.js';
import { startEmailWorker } from './lib/email/worker.js';

async function bootstrap() {
  console.log('[Startup] Bootstrapping Revelis Server...');
  
  // 3. Connect to Database
  const dbStart = performance.now();
  const { sql } = await import('./db/client.js');
  try {
    await sql`SELECT 1`;
  } catch (err: any) {
    console.error('[Startup] Failed to perform database handshake:', err.message);
    // A server that cannot reach its database must not report itself healthy.
    if (env.NODE_ENV === 'production') {
      console.error('[Startup] Database is unreachable in production. Aborting startup.');
      process.exit(1);
    }
  }
  const dbConnectTime = performance.now() - dbStart;

  // 4. Connect to Redis
  const redisStart = performance.now();
  const { cacheService } = await import('./lib/cache.js');
  try {
    await cacheService.exists('revelis:health_check_ping');
  } catch (err: any) {
    console.error('[Startup] Failed to perform Redis handshake:', err.message);
  }
  const redisConnectTime = performance.now() - redisStart;

  // 5. Initialize background workers
  const workerStart = performance.now();
  startEmailWorker();
  const workerInitTime = performance.now() - workerStart;

  // 6. Start Web Server
  const serverStart = performance.now();
  const server = serve({
    fetch: app.fetch,
    port: env.PORT
  }, (info) => {
    // Attach the realtime vibe-chat websocket upgrade handler to this server.
    injectVibesWebSocket(server);
    const serverStartTime = performance.now() - serverStart;
    const totalDuration = performance.now() - startTimestamp;

    console.log(`\n=========================================================`);
    console.log(`REVELIS ENTERPRISE STARTUP DIAGNOSTICS`);
    console.log(`=========================================================`);
    console.log(`Configuration Load Time : ${configLoadTime.toFixed(1)}ms`);
    console.log(`PostgreSQL Connect Time : ${dbConnectTime.toFixed(1)}ms`);
    console.log(`Redis Connect Time      : ${redisConnectTime.toFixed(1)}ms`);
    console.log(`Worker Init Time        : ${workerInitTime.toFixed(1)}ms`);
    console.log(`HTTP Server Listen Time : ${serverStartTime.toFixed(1)}ms`);
    console.log(`---------------------------------------------------------`);
    console.log(`TOTAL STARTUP DURATION  : ${totalDuration.toFixed(1)}ms`);
    console.log(`=========================================================\n`);

    // Flag the application container as fully started and healthy for /health/startup
    (global as any).isAppReady = true;

    // Register recurring maintenance / financial-integrity schedules (idempotent).
    // Runs after listen so a registration hiccup never blocks readiness.
    import('./jobs/schedules.js')
      .then(({ registerRecurringSchedules }) => registerRecurringSchedules())
      .catch((err) => console.error('[Startup] Failed to register recurring schedules:', err?.message));
  });

  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}. Starting graceful shutdown...`);
    
    const { stopEmailWorker } = await import('./lib/email/worker.js');
    stopEmailWorker();
    
    server.close(async () => {
      console.log('HTTP server closed.');
      
      try {
        const { sql: dbSql } = await import('./db/client.js');
        await dbSql.end();
        console.log('Postgres connection pool ended.');
      } catch (e) {
        console.error('Error closing Postgres connection pool:', e);
      }
      
      try {
        const { cacheService: cache } = await import('./lib/cache.js');
        await cache.close();
        console.log('Redis client closed.');
      } catch (e) {
        console.error('Error closing Redis client:', e);
      }
      
      console.log('Graceful shutdown completed.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[Startup] Critical boot failure:', err);
  process.exit(1);
});
