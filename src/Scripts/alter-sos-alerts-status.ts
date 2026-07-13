/**
 * Add dispatch-lifecycle columns to sos_alerts (idempotent). Additive.
 * Run: `npm run create:sos`.
 *
 * Adds `status` (active|acknowledged|resolved|cancelled) + `acknowledged_at`
 * so the dashboard SOS console can triage and resolve alerts.
 */
import { sql } from '../db/client.js';

async function main() {
  console.log('▶ Altering sos_alerts (status + acknowledged_at)…');

  await sql`ALTER TABLE sos_alerts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE sos_alerts ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz`;
  await sql`CREATE INDEX IF NOT EXISTS sos_alerts_status_idx ON sos_alerts (status)`;

  console.log('✅ sos_alerts is console-ready.');
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
