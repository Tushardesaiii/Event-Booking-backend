import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';
async function test() {
  console.log('Testing db connection...');
  const res = await db.execute(sql`SELECT 1 as val`);
  console.log('Result:', res);
  process.exit(0);
}
test().catch((err) => {
  console.error('DB error:', err);
  process.exit(1);
});
