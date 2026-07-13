/**
 * Create the settlements table (idempotent). Additive. Run: `npm run create:settlements`.
 */
import { sql } from '../db/client.js';

async function main() {
  console.log('▶ Creating settlements table…');

  await sql`
    CREATE TABLE IF NOT EXISTS settlements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      type text NOT NULL,
      gross_sales bigint NOT NULL DEFAULT 0,
      platform_fee bigint NOT NULL DEFAULT 0,
      refunds bigint NOT NULL DEFAULT 0,
      net_payable bigint NOT NULL DEFAULT 0,
      cheque_no text,
      scheduled_date text,
      status text NOT NULL DEFAULT 'pending',
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS settlements_tenant_id_idx ON settlements (tenant_id)`;
  await sql`CREATE INDEX IF NOT EXISTS settlements_event_id_idx ON settlements (event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS settlements_status_idx ON settlements (status)`;

  console.log('✅ Settlements table ready.');
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
