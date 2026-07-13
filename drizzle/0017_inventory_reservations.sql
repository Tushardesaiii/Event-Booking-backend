ALTER TYPE "booking_order_status" ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE "booking_order_status" ADD VALUE IF NOT EXISTS 'completed';

DO $$ BEGIN
  CREATE TYPE "inventory_reservation_status" AS ENUM ('active', 'converted', 'expired', 'released', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "inventory_event_type" AS ENUM ('reservation_created', 'reservation_expired', 'reservation_released', 'reservation_converted', 'booking_confirmed', 'inventory_adjusted', 'refund_restored', 'admin_override');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "inventory_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
  "ticket_type_id" uuid NOT NULL REFERENCES "ticket_types"("id") ON DELETE cascade,
  "booking_order_id" uuid REFERENCES "booking_orders"("id") ON DELETE set null,
  "reservation_token" text NOT NULL,
  "quantity" integer NOT NULL,
  "status" "inventory_reservation_status" NOT NULL DEFAULT 'active',
  "expires_at" timestamp with time zone NOT NULL,
  "converted_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "inventory_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
  "ticket_type_id" uuid NOT NULL REFERENCES "ticket_types"("id") ON DELETE cascade,
  "reservation_id" uuid REFERENCES "inventory_reservations"("id") ON DELETE set null,
  "booking_order_id" uuid REFERENCES "booking_orders"("id") ON DELETE set null,
  "event_type" "inventory_event_type" NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "source" text,
  "correlation_id" text,
  "previous_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "new_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "inventory_reservations_tenant_id_idx" ON "inventory_reservations" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "inventory_reservations_event_id_idx" ON "inventory_reservations" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "inventory_reservations_ticket_type_id_idx" ON "inventory_reservations" USING btree ("ticket_type_id");
CREATE INDEX IF NOT EXISTS "inventory_reservations_booking_order_id_idx" ON "inventory_reservations" USING btree ("booking_order_id");
CREATE INDEX IF NOT EXISTS "inventory_reservations_status_idx" ON "inventory_reservations" USING btree ("status");
CREATE INDEX IF NOT EXISTS "inventory_reservations_expires_at_idx" ON "inventory_reservations" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "inventory_reservations_tenant_status_expires_idx" ON "inventory_reservations" USING btree ("tenant_id", "ticket_type_id", "status", "expires_at") WHERE "deleted_at" IS NULL AND "status" = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_reservations_tenant_token_unique" ON "inventory_reservations" USING btree ("tenant_id", "reservation_token");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_reservations_tenant_booking_order_ticket_unique" ON "inventory_reservations" USING btree ("tenant_id", "booking_order_id", "ticket_type_id") WHERE "deleted_at" IS NULL AND "booking_order_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "inventory_events_tenant_id_idx" ON "inventory_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "inventory_events_event_id_idx" ON "inventory_events" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "inventory_events_ticket_type_id_idx" ON "inventory_events" USING btree ("ticket_type_id");
CREATE INDEX IF NOT EXISTS "inventory_events_reservation_id_idx" ON "inventory_events" USING btree ("reservation_id");
CREATE INDEX IF NOT EXISTS "inventory_events_booking_order_id_idx" ON "inventory_events" USING btree ("booking_order_id");
CREATE INDEX IF NOT EXISTS "inventory_events_event_type_idx" ON "inventory_events" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "inventory_events_created_at_idx" ON "inventory_events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "inventory_events_tenant_created_at_idx" ON "inventory_events" USING btree ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "booking_orders_tenant_status_idx" ON "booking_orders" USING btree ("tenant_id", "status") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "booking_order_items_tenant_ticket_type_idx" ON "booking_order_items" USING btree ("tenant_id", "ticket_type_id");
CREATE INDEX IF NOT EXISTS "ticket_types_tenant_event_status_idx" ON "ticket_types" USING btree ("tenant_id", "event_id", "status") WHERE "deleted_at" IS NULL;