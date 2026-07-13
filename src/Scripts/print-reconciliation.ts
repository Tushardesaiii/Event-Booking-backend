import { db } from '../db/client.js';
import { ledgerReconciliation } from '../db/schema/ledger.js';
import { desc } from 'drizzle-orm';

async function run() {
  const [last] = await db
    .select()
    .from(ledgerReconciliation)
    .orderBy(desc(ledgerReconciliation.createdAt))
    .limit(1);
  console.log('RECONCILIATION_REPORT_START');
  console.log(JSON.stringify(last, null, 2));
  console.log('RECONCILIATION_REPORT_END');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
