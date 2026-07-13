DO $$ BEGIN
  CREATE TYPE "issued_ticket_status" AS ENUM ('issued', 'checked_in', 'cancelled', 'transferred', 'refunded', 'invalidated');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "issued_ticket_counters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
  "ticket_type_id" uuid NOT NULL REFERENCES "ticket_types"("id") ON DELETE cascade,
  "year" integer NOT NULL,
  "prefix" text NOT NULL,
  "next_sequence" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "issued_ticket_counters_tenant_id_idx" ON "issued_ticket_counters" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "issued_ticket_counters_event_id_idx" ON "issued_ticket_counters" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "issued_ticket_counters_ticket_type_id_idx" ON "issued_ticket_counters" USING btree ("ticket_type_id");
CREATE INDEX IF NOT EXISTS "issued_ticket_counters_year_idx" ON "issued_ticket_counters" USING btree ("year");
CREATE UNIQUE INDEX IF NOT EXISTS "issued_ticket_counters_tenant_event_year_prefix_unique" ON "issued_ticket_counters" USING btree ("tenant_id", "event_id", "year", "prefix");

CREATE TABLE IF NOT EXISTS "issued_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE restrict,
  "ticket_type_id" uuid NOT NULL REFERENCES "ticket_types"("id") ON DELETE restrict,
  "attendee_id" uuid REFERENCES "attendees"("id") ON DELETE set null,
  "booking_order_id" uuid NOT NULL REFERENCES "booking_orders"("id") ON DELETE restrict,
  "booking_order_item_id" uuid NOT NULL REFERENCES "booking_order_items"("id") ON DELETE restrict,
  "ticket_number" text NOT NULL,
  "qr_code_token" text NOT NULL,
  "status" "issued_ticket_status" DEFAULT 'issued' NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_in_at" timestamp with time zone,
  "transferred_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "invalidated_at" timestamp with time zone,
  "ticket_type_name_snapshot" text NOT NULL,
  "ticket_type_slug_snapshot" text NOT NULL,
  "unit_price_snapshot" numeric(14,2) NOT NULL,
  "currency_snapshot" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_id_idx" ON "issued_tickets" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "issued_tickets_event_id_idx" ON "issued_tickets" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "issued_tickets_ticket_type_id_idx" ON "issued_tickets" USING btree ("ticket_type_id");
CREATE INDEX IF NOT EXISTS "issued_tickets_attendee_id_idx" ON "issued_tickets" USING btree ("attendee_id");
CREATE INDEX IF NOT EXISTS "issued_tickets_booking_order_id_idx" ON "issued_tickets" USING btree ("booking_order_id");
CREATE INDEX IF NOT EXISTS "issued_tickets_booking_order_item_id_idx" ON "issued_tickets" USING btree ("booking_order_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "issued_tickets_tenant_ticket_number_unique" ON "issued_tickets" USING btree ("tenant_id", "ticket_number");
CREATE UNIQUE INDEX IF NOT EXISTS "issued_tickets_qr_code_token_unique" ON "issued_tickets" USING btree ("qr_code_token");
CREATE UNIQUE INDEX IF NOT EXISTS "issued_tickets_tenant_attendee_unique" ON "issued_tickets" USING btree ("tenant_id", "attendee_id") WHERE ("attendee_id" IS NOT NULL AND "deleted_at" IS NULL);
CREATE INDEX IF NOT EXISTS "issued_tickets_status_idx" ON "issued_tickets" USING btree ("status");
CREATE INDEX IF NOT EXISTS "issued_tickets_issued_at_idx" ON "issued_tickets" USING btree ("issued_at");
CREATE INDEX IF NOT EXISTS "issued_tickets_checked_in_at_idx" ON "issued_tickets" USING btree ("checked_in_at");
CREATE INDEX IF NOT EXISTS "issued_tickets_created_at_idx" ON "issued_tickets" USING btree ("created_at");
