CREATE TABLE "group_booking_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_booking_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_booking_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"invite_status" text DEFAULT 'invited' NOT NULL,
	"contribution_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"booking_order_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"collected_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_booking_activity" ADD CONSTRAINT "group_booking_activity_group_booking_id_group_bookings_id_fk" FOREIGN KEY ("group_booking_id") REFERENCES "public"."group_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_booking_activity" ADD CONSTRAINT "group_booking_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_booking_members" ADD CONSTRAINT "group_booking_members_group_booking_id_group_bookings_id_fk" FOREIGN KEY ("group_booking_id") REFERENCES "public"."group_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_booking_members" ADD CONSTRAINT "group_booking_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_bookings" ADD CONSTRAINT "group_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_bookings" ADD CONSTRAINT "group_bookings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_bookings" ADD CONSTRAINT "group_bookings_booking_order_id_booking_orders_id_fk" FOREIGN KEY ("booking_order_id") REFERENCES "public"."booking_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_bookings" ADD CONSTRAINT "group_bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_booking_activity_group_booking_id_idx" ON "group_booking_activity" USING btree ("group_booking_id");--> statement-breakpoint
CREATE INDEX "group_booking_members_group_booking_id_idx" ON "group_booking_members" USING btree ("group_booking_id");--> statement-breakpoint
CREATE INDEX "group_booking_members_user_id_idx" ON "group_booking_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_booking_members_role_idx" ON "group_booking_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "group_booking_members_invite_status_idx" ON "group_booking_members" USING btree ("invite_status");--> statement-breakpoint
CREATE INDEX "group_bookings_tenant_id_idx" ON "group_bookings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "group_bookings_event_id_idx" ON "group_bookings" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "group_bookings_booking_order_id_idx" ON "group_bookings" USING btree ("booking_order_id");--> statement-breakpoint
CREATE INDEX "group_bookings_created_by_user_id_idx" ON "group_bookings" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "group_bookings_status_idx" ON "group_bookings" USING btree ("status");