CREATE TYPE "public"."profile_visibility" AS ENUM('public', 'followers_only', 'private');--> statement-breakpoint
CREATE TABLE "buddy_preferences" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"bio" text,
	"age_range_min" integer DEFAULT 18 NOT NULL,
	"age_range_max" integer DEFAULT 99 NOT NULL,
	"gender_preference" varchar(50) DEFAULT 'any' NOT NULL,
	"preferred_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_cities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"achievement_type" varchar(100) NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"target_value" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity_type" varchar(100) NOT NULL,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"badge_type" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_followers" (
	"follower_profile_id" uuid NOT NULL,
	"following_profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_followers_follower_profile_id_following_profile_id_pk" PRIMARY KEY("follower_profile_id","following_profile_id")
);
--> statement-breakpoint
CREATE TABLE "profile_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"interest" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_preferences" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"preferred_cities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_artists" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_price_range_min" numeric(14, 2),
	"preferred_price_range_max" numeric(14, 2),
	"preferred_event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discovery_radius_km" integer DEFAULT 50 NOT NULL,
	"notification_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"review_text" text,
	"moderated" boolean DEFAULT false NOT NULL,
	"moderation_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_saved_events" (
	"profile_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_saved_events_profile_id_event_id_pk" PRIMARY KEY("profile_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "profile_social_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform" varchar(50) NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"verification_type" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewer_id" uuid
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"username" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"avatar_url" text,
	"cover_url" text,
	"bio" text,
	"city" varchar(255),
	"state" varchar(255),
	"country" varchar(255),
	"gender" varchar(50),
	"date_of_birth" timestamp with time zone,
	"phone_visibility" boolean DEFAULT false NOT NULL,
	"email_visibility" boolean DEFAULT false NOT NULL,
	"profile_visibility" "profile_visibility" DEFAULT 'public' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "trusted_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(100) NOT NULL,
	"relationship" varchar(100) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buddy_preferences" ADD CONSTRAINT "buddy_preferences_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_preferences" ADD CONSTRAINT "buddy_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_achievements" ADD CONSTRAINT "profile_achievements_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_achievements" ADD CONSTRAINT "profile_achievements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_activity" ADD CONSTRAINT "profile_activity_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_activity" ADD CONSTRAINT "profile_activity_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_badges" ADD CONSTRAINT "profile_badges_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_badges" ADD CONSTRAINT "profile_badges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_followers" ADD CONSTRAINT "profile_followers_follower_profile_id_profiles_id_fk" FOREIGN KEY ("follower_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_followers" ADD CONSTRAINT "profile_followers_following_profile_id_profiles_id_fk" FOREIGN KEY ("following_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_followers" ADD CONSTRAINT "profile_followers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_preferences" ADD CONSTRAINT "profile_preferences_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_preferences" ADD CONSTRAINT "profile_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reviews" ADD CONSTRAINT "profile_reviews_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reviews" ADD CONSTRAINT "profile_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_saved_events" ADD CONSTRAINT "profile_saved_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_saved_events" ADD CONSTRAINT "profile_saved_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_saved_events" ADD CONSTRAINT "profile_saved_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_social_links" ADD CONSTRAINT "profile_social_links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_social_links" ADD CONSTRAINT "profile_social_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_verification_requests" ADD CONSTRAINT "profile_verification_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_verification_requests" ADD CONSTRAINT "profile_verification_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_verification_requests" ADD CONSTRAINT "profile_verification_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_achievements_unique_idx" ON "profile_achievements" USING btree ("profile_id","achievement_type");--> statement-breakpoint
CREATE INDEX "profile_achievements_tenant_idx" ON "profile_achievements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profile_activity_profile_idx" ON "profile_activity" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_activity_tenant_idx" ON "profile_activity" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profile_activity_created_at_idx" ON "profile_activity" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_badges_unique_idx" ON "profile_badges" USING btree ("profile_id","badge_type");--> statement-breakpoint
CREATE INDEX "profile_badges_tenant_idx" ON "profile_badges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profile_followers_tenant_idx" ON "profile_followers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_interests_unique_idx" ON "profile_interests" USING btree ("profile_id","interest");--> statement-breakpoint
CREATE INDEX "profile_interests_tenant_idx" ON "profile_interests" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_reviews_unique_idx" ON "profile_reviews" USING btree ("profile_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "profile_reviews_tenant_idx" ON "profile_reviews" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profile_saved_events_tenant_idx" ON "profile_saved_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profile_social_links_profile_idx" ON "profile_social_links" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_social_links_tenant_idx" ON "profile_social_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profile_verification_requests_profile_idx" ON "profile_verification_requests" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_verification_requests_tenant_idx" ON "profile_verification_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_tenant_unique_idx" ON "profiles" USING btree ("tenant_id","username");--> statement-breakpoint
CREATE INDEX "profiles_tenant_idx" ON "profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profiles_deleted_at_idx" ON "profiles" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "profiles_city_idx" ON "profiles" USING btree ("city");--> statement-breakpoint
CREATE INDEX "trusted_contacts_profile_idx" ON "trusted_contacts" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "trusted_contacts_tenant_idx" ON "trusted_contacts" USING btree ("tenant_id");