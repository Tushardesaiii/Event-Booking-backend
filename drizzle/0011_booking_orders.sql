CREATE TYPE "public"."booking_order_status" AS ENUM('draft', 'pending', 'confirmed', 'cancelled', 'expired', 'refunded', 'partially_refunded');
CREATE TYPE "public"."booking_order_source" AS ENUM('web', 'admin', 'mobile', 'walk_in', 'kiosk', 'partner');

CREATE TABLE "booking_order_counters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "year" integer NOT NULL,
  "prefix" text NOT NULL,
  "next_sequence" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "booking_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "purchaser_user_id" uuid NOT NULL,
  "order_number" text NOT NULL,
  "status" "booking_order_status" DEFAULT 'pending' NOT NULL,
  "currency" text NOT NULL,
  "subtotal_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
  "tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
  "discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
  "total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
  "source" "booking_order_source" DEFAULT 'web' NOT NULL,
  "notes" text,
  "expires_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancellation_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE TABLE "booking_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "booking_order_id" uuid NOT NULL,
  "ticket_type_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price" numeric(14, 2) NOT NULL,
  "subtotal_amount" numeric(14, 2) NOT NULL,
  "tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
  "total_amount" numeric(14, 2) NOT NULL,
  "currency" text NOT NULL,
  "ticket_name_snapshot" text NOT NULL,
  "ticket_slug_snapshot" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "booking_order_item_attendees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "booking_order_id" uuid NOT NULL,
  "booking_order_item_id" uuid NOT NULL,
  "attendee_id" uuid NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "assigned_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "booking_order_counters"
  ADD CONSTRAINT "booking_order_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_order_counters"
  ADD CONSTRAINT "booking_order_counters_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "booking_orders"
  ADD CONSTRAINT "booking_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_orders"
  ADD CONSTRAINT "booking_orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "booking_orders"
  ADD CONSTRAINT "booking_orders_purchaser_user_id_users_id_fk" FOREIGN KEY ("purchaser_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "booking_orders"
  ADD CONSTRAINT "booking_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "booking_orders"
  ADD CONSTRAINT "booking_orders_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "booking_order_items"
  ADD CONSTRAINT "booking_order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_order_items"
  ADD CONSTRAINT "booking_order_items_booking_order_id_booking_orders_id_fk" FOREIGN KEY ("booking_order_id") REFERENCES "public"."booking_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_order_items"
  ADD CONSTRAINT "booking_order_items_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "booking_order_item_attendees"
  ADD CONSTRAINT "booking_order_item_attendees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_order_item_attendees"
  ADD CONSTRAINT "booking_order_item_attendees_booking_order_id_booking_orders_id_fk" FOREIGN KEY ("booking_order_id") REFERENCES "public"."booking_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_order_item_attendees"
  ADD CONSTRAINT "booking_order_item_attendees_booking_order_item_id_booking_order_items_id_fk" FOREIGN KEY ("booking_order_item_id") REFERENCES "public"."booking_order_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_order_item_attendees"
  ADD CONSTRAINT "booking_order_item_attendees_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "booking_order_item_attendees"
  ADD CONSTRAINT "booking_order_item_attendees_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "booking_order_counters_tenant_id_idx" ON "booking_order_counters" USING btree ("tenant_id");
CREATE INDEX "booking_order_counters_event_id_idx" ON "booking_order_counters" USING btree ("event_id");
CREATE INDEX "booking_order_counters_year_idx" ON "booking_order_counters" USING btree ("year");
CREATE UNIQUE INDEX "booking_order_counters_tenant_event_year_unique" ON "booking_order_counters" USING btree ("tenant_id", "event_id", "year");

CREATE INDEX "booking_orders_tenant_id_idx" ON "booking_orders" USING btree ("tenant_id");
CREATE INDEX "booking_orders_event_id_idx" ON "booking_orders" USING btree ("event_id");
CREATE INDEX "booking_orders_purchaser_user_id_idx" ON "booking_orders" USING btree ("purchaser_user_id");
CREATE INDEX "booking_orders_order_number_idx" ON "booking_orders" USING btree ("order_number");
CREATE INDEX "booking_orders_status_idx" ON "booking_orders" USING btree ("status");
CREATE INDEX "booking_orders_source_idx" ON "booking_orders" USING btree ("source");
CREATE INDEX "booking_orders_created_at_idx" ON "booking_orders" USING btree ("created_at");
CREATE UNIQUE INDEX "booking_orders_tenant_order_number_unique" ON "booking_orders" USING btree ("tenant_id", "order_number");

CREATE INDEX "booking_order_items_tenant_id_idx" ON "booking_order_items" USING btree ("tenant_id");
CREATE INDEX "booking_order_items_booking_order_id_idx" ON "booking_order_items" USING btree ("booking_order_id");
CREATE INDEX "booking_order_items_ticket_type_id_idx" ON "booking_order_items" USING btree ("ticket_type_id");
CREATE UNIQUE INDEX "booking_order_items_order_ticket_unique" ON "booking_order_items" USING btree ("booking_order_id", "ticket_type_id");
CREATE INDEX "booking_order_items_created_at_idx" ON "booking_order_items" USING btree ("created_at");

CREATE INDEX "booking_order_item_attendees_tenant_id_idx" ON "booking_order_item_attendees" USING btree ("tenant_id");
CREATE INDEX "booking_order_item_attendees_booking_order_id_idx" ON "booking_order_item_attendees" USING btree ("booking_order_id");
CREATE INDEX "booking_order_item_attendees_booking_order_item_id_idx" ON "booking_order_item_attendees" USING btree ("booking_order_item_id");
CREATE INDEX "booking_order_item_attendees_attendee_id_idx" ON "booking_order_item_attendees" USING btree ("attendee_id");
CREATE UNIQUE INDEX "booking_order_item_attendees_active_attendee_unique" ON "booking_order_item_attendees" USING btree ("tenant_id", "attendee_id") WHERE deleted_at is null;
CREATE UNIQUE INDEX "booking_order_item_attendees_active_item_attendee_unique" ON "booking_order_item_attendees" USING btree ("booking_order_item_id", "attendee_id") WHERE deleted_at is null;
CREATE INDEX "booking_order_item_attendees_created_at_idx" ON "booking_order_item_attendees" USING btree ("created_at");