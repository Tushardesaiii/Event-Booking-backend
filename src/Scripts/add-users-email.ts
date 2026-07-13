// One-off, idempotent migration: add the nullable consumer `email` column to
// the users table. Safe to run multiple times.
import { sql } from '../db/client.js';

async function main() {
  await sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text`;
  const [{ exists }] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'email'
    ) AS exists
  `;
  console.log('users.email column present:', exists);
  await sql.end();
}

main().catch(async (e) => {
  console.error('migration failed:', e);
  try { await sql.end(); } catch {}
  process.exit(1);
});
