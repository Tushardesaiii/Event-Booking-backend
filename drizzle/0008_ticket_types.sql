DO $$
BEGIN
  CREATE TYPE "ticket_status" AS ENUM ('draft', 'active', 'paused', 'sold_out', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ticket_visibility" AS ENUM ('public', 'hidden', 'invite_only');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ticket_tax_behavior" AS ENUM ('inclusive', 'exclusive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ticket_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "price" numeric(14, 2) NOT NULL DEFAULT '0',
  "currency" text NOT NULL DEFAULT 'INR',
  "tax_behavior" "ticket_tax_behavior" NOT NULL DEFAULT 'exclusive',
  "total_quantity" integer NOT NULL DEFAULT 0,
  "sold_quantity" integer NOT NULL DEFAULT 0,
  "reserved_quantity" integer NOT NULL DEFAULT 0,
  "min_per_order" integer NOT NULL DEFAULT 1,
  "max_per_order" integer NOT NULL DEFAULT 10,
  "sale_start_date" timestamp with time zone,
  "sale_end_date" timestamp with time zone,
  "visibility" "ticket_visibility" NOT NULL DEFAULT 'public',
  "status" "ticket_status" NOT NULL DEFAULT 'draft',
  "is_transferable" boolean NOT NULL DEFAULT false,
  "is_refundable" boolean NOT NULL DEFAULT false,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "ticket_types_price_non_negative" CHECK ("price" >= 0),
  CONSTRAINT "ticket_types_inventory_non_negative" CHECK (
    "total_quantity" >= 0
    AND "sold_quantity" >= 0
    AND "reserved_quantity" >= 0
  ),
  CONSTRAINT "ticket_types_inventory_balance" CHECK (
    "sold_quantity" <= "total_quantity"
    AND "reserved_quantity" <= "total_quantity"
    AND ("sold_quantity" + "reserved_quantity") <= "total_quantity"
  ),
  CONSTRAINT "ticket_types_purchase_limits" CHECK ("min_per_order" <= "max_per_order"),
  CONSTRAINT "ticket_types_sale_window" CHECK (
    "sale_start_date" IS NULL OR "sale_end_date" IS NULL OR "sale_end_date" > "sale_start_date"
  )
);

CREATE INDEX IF NOT EXISTS "ticket_types_tenant_id_idx" ON "ticket_types" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "ticket_types_event_id_idx" ON "ticket_types" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "ticket_types_slug_idx" ON "ticket_types" USING btree ("slug");
CREATE INDEX IF NOT EXISTS "ticket_types_status_idx" ON "ticket_types" USING btree ("status");
CREATE INDEX IF NOT EXISTS "ticket_types_visibility_idx" ON "ticket_types" USING btree ("visibility");
CREATE INDEX IF NOT EXISTS "ticket_types_sale_start_date_idx" ON "ticket_types" USING btree ("sale_start_date");
CREATE INDEX IF NOT EXISTS "ticket_types_sale_end_date_idx" ON "ticket_types" USING btree ("sale_end_date");
CREATE INDEX IF NOT EXISTS "ticket_types_price_idx" ON "ticket_types" USING btree ("price");
CREATE INDEX IF NOT EXISTS "ticket_types_created_at_idx" ON "ticket_types" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_types_tenant_slug_unique" ON "ticket_types" USING btree ("tenant_id", "slug") WHERE "deleted_at" IS NULL;
