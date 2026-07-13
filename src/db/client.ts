import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env.js';
import * as schema from './schema/index.js';

const isProduction = env.NODE_ENV === 'production';

export const sql = postgres(env.DATABASE_URL, {
  // Pool sizing is overridable so it can be tuned to the DB's max_connections
  // divided by the number of replicas (avoids exhausting Postgres at scale).
  max: env.DB_POOL_MAX,
  // Recycle idle connections so a shrinking workload releases DB slots.
  idle_timeout: env.DB_IDLE_TIMEOUT,
  // Fail fast if a new connection can't be established.
  connect_timeout: env.DB_CONNECT_TIMEOUT,
  // Cap how long any single statement may run so a hung query cannot hold a pool
  // slot indefinitely (defence against slow-query pool exhaustion).
  connection: {
    statement_timeout: env.DB_STATEMENT_TIMEOUT * 1000,
  },
  ssl: isProduction ? 'require' : 'prefer'
});

export const db = drizzle(sql, { schema });
