import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Truncating all database tables for a clean test run...');
  await db.execute(sql`TRUNCATE TABLE users, tenants CASCADE`);
  console.log('Database tables truncated successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to truncate tables:', err);
  process.exit(1);
});
