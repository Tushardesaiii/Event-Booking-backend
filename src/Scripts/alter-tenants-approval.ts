/**
 * Add the organizer-onboarding approval workflow columns to `tenants` (idempotent).
 * Additive. Run: `npm run create:organizer-approval`.
 *
 * A tenant is the workspace an organizer signs into on the dashboard, so the
 * "become an organizer" approval state lives here:
 *   • approval_status  — pending | approved | rejected (gates dashboard access)
 *   • rejection_reason — shown to the organizer on the rejected screen
 *
 * Existing tenants predate the feature, so they are backfilled to 'approved'
 * (the ADD COLUMN default), then the column default is flipped to 'pending' so
 * every *new* registration lands in the review queue. Re-running is safe.
 */
import { sql } from '../db/client.js';

async function main() {
  console.log('▶ Altering tenants (approval_status + rejection_reason)…');

  // Existing rows get 'approved' from the ADD default; new inserts get 'pending'
  // from the flipped default below.
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'`;
  await sql`ALTER TABLE tenants ALTER COLUMN approval_status SET DEFAULT 'pending'`;
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rejection_reason text`;
  await sql`CREATE INDEX IF NOT EXISTS tenants_approval_status_idx ON tenants (approval_status)`;

  console.log('✅ tenants is approval-workflow-ready.');
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
