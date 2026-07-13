DO $$ BEGIN
  CREATE TYPE "issued_ticket_event_type" AS ENUM ('ticket_validated', 'ticket_checked_in', 'ticket_invalidated', 'ticket_refunded', 'ticket_cancelled', 'ticket_transferred', 'ticket_validation_rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "issued_ticket_validation_outcome" AS ENUM ('valid', 'already_checked_in', 'cancelled', 'invalidated', 'refunded', 'deleted', 'tenant_mismatch', 'stale_ticket', 'invalid_qr', 'unauthorized_scanner');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "issued_tickets"
  ADD COLUMN IF NOT EXISTS "successful_validation_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failed_validation_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_validation_attempt_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_successful_validation_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_validation_failure_reason" text,
  ADD COLUMN IF NOT EXISTS "last_validation_source" text,
  ADD COLUMN IF NOT EXISTS "last_scanner_device_id" text,
  ADD COLUMN IF NOT EXISTS "last_scanner_gate" text,
  ADD COLUMN IF NOT EXISTS "last_scanner_operator_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "issued_ticket_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "issued_ticket_id" uuid REFERENCES "issued_tickets"("id") ON DELETE cascade,
  "event_type" "issued_ticket_event_type" NOT NULL,
  "outcome" "issued_ticket_validation_outcome" NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "scanner_device_id" text,
  "scanner_gate" text,
  "scanner_operator_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_validation_attempt_idx" ON "issued_tickets" USING btree ("tenant_id", "last_validation_attempt_at") WHERE ("deleted_at" IS NULL);
CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_successful_validation_idx" ON "issued_tickets" USING btree ("tenant_id", "last_successful_validation_at") WHERE ("deleted_at" IS NULL);
CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_scanner_device_idx" ON "issued_tickets" USING btree ("tenant_id", "last_scanner_device_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX IF NOT EXISTS "issued_ticket_events_tenant_id_idx" ON "issued_ticket_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "issued_ticket_events_issued_ticket_id_idx" ON "issued_ticket_events" USING btree ("issued_ticket_id");
CREATE INDEX IF NOT EXISTS "issued_ticket_events_event_type_idx" ON "issued_ticket_events" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "issued_ticket_events_created_at_idx" ON "issued_ticket_events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "issued_ticket_events_tenant_created_at_idx" ON "issued_ticket_events" USING btree ("tenant_id", "created_at");