CREATE TABLE "organizer_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizer_safety_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"emergency_helpline_number" text,
	"emergency_whatsapp_number" text,
	"medical_help_desk_info" text,
	"lost_and_found_desk_info" text,
	"women_safety_desk_info" text,
	"security_desk_info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizer_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" uuid,
	"reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sos_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"event_id" uuid,
	"organizer_id" uuid,
	"location_name" text,
	"latitude" text,
	"longitude" text,
	"issue_category" text NOT NULL,
	"severity" text NOT NULL,
	"details" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "emergency_contact" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "medical_desk" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "security_desk" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "women_safety_desk" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lost_and_found_desk" text;--> statement-breakpoint
ALTER TABLE "organizer_reviews" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "organizer_reviews" ADD COLUMN "review_text" text;--> statement-breakpoint
ALTER TABLE "organizer_reviews" ADD COLUMN "visit_event_id" uuid;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "cover_image" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "instagram" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "facebook" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "twitter_x" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "youtube" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "verification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "support_email" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "support_phone" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "emergency_helpline_number" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "emergency_whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizer_likes" ADD CONSTRAINT "organizer_likes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_likes" ADD CONSTRAINT "organizer_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_likes" ADD CONSTRAINT "organizer_likes_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_safety_profiles" ADD CONSTRAINT "organizer_safety_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_safety_profiles" ADD CONSTRAINT "organizer_safety_profiles_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_verifications" ADD CONSTRAINT "organizer_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_verifications" ADD CONSTRAINT "organizer_verifications_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_verifications" ADD CONSTRAINT "organizer_verifications_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizer_likes_tenant_id_idx" ON "organizer_likes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organizer_likes_user_id_idx" ON "organizer_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizer_likes_organizer_id_idx" ON "organizer_likes" USING btree ("organizer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizer_likes_tenant_user_org_unique" ON "organizer_likes" USING btree ("tenant_id","user_id","organizer_id");--> statement-breakpoint
CREATE INDEX "organizer_safety_profiles_tenant_id_idx" ON "organizer_safety_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organizer_safety_profiles_organizer_id_idx" ON "organizer_safety_profiles" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "organizer_verifications_tenant_id_idx" ON "organizer_verifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organizer_verifications_organizer_id_idx" ON "organizer_verifications" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "sos_alerts_tenant_id_idx" ON "sos_alerts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sos_alerts_event_id_idx" ON "sos_alerts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sos_alerts_organizer_id_idx" ON "sos_alerts" USING btree ("organizer_id");--> statement-breakpoint
ALTER TABLE "organizer_reviews" ADD CONSTRAINT "organizer_reviews_visit_event_id_events_id_fk" FOREIGN KEY ("visit_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;