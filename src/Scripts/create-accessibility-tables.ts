/**
 * Create the accessibility tables (idempotent). Additive — does not touch any
 * existing tables. Run once: `npm run create:accessibility`.
 */
import { sql } from '../db/client.js';

async function main() {
  console.log('▶ Creating accessibility tables…');

  await sql`
    CREATE TABLE IF NOT EXISTS accessibility_zones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name text NOT NULL,
      gate text,
      total integer NOT NULL DEFAULT 0,
      used integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS accessibility_zones_tenant_id_idx ON accessibility_zones (tenant_id)`;
  await sql`CREATE INDEX IF NOT EXISTS accessibility_zones_event_id_idx ON accessibility_zones (event_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS accessibility_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      attendee_name text NOT NULL,
      contact text,
      need text NOT NULL,
      gate text,
      status text NOT NULL DEFAULT 'pending',
      notes text,
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS accessibility_requests_tenant_id_idx ON accessibility_requests (tenant_id)`;
  await sql`CREATE INDEX IF NOT EXISTS accessibility_requests_event_id_idx ON accessibility_requests (event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS accessibility_requests_status_idx ON accessibility_requests (status)`;

  console.log('✅ Accessibility tables ready.');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
