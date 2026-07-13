CREATE TYPE "public"."artist_verification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "artist_alerts" (
	"user_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"radius_km" integer DEFAULT 50 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_alerts_user_id_artist_id_pk" PRIMARY KEY("user_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "artist_followers" (
	"artist_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_followers_artist_id_user_id_pk" PRIMARY KEY("artist_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "artist_genre_lookup" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_genres" (
	"artist_id" uuid NOT NULL,
	"genre_id" integer NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "artist_genres_artist_id_genre_id_pk" PRIMARY KEY("artist_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "artist_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"media_url" varchar(512) NOT NULL,
	"caption" text,
	"expires_at" timestamp with time zone NOT NULL,
	"type" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_verifications" (
	"artist_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "artist_verification_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewer_id" uuid,
	CONSTRAINT "artist_verifications_artist_id_pk" PRIMARY KEY("artist_id")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(255) NOT NULL,
	"stage_name" varchar(255) NOT NULL,
	"real_name" varchar(255),
	"bio" text,
	"short_bio" text,
	"profile_image_url" varchar(512),
	"cover_image_url" varchar(512),
	"city" varchar(255),
	"state" varchar(255),
	"country" varchar(255),
	"genres" jsonb,
	"languages" jsonb,
	"instagram_url" varchar(512),
	"youtube_url" varchar(512),
	"spotify_url" varchar(512),
	"website_url" varchar(512),
	"booking_email" varchar(255),
	"management_contact" varchar(255),
	"verified" boolean DEFAULT false NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_artists" (
	"event_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"headline" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"performance_type" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_artists_event_id_artist_id_pk" PRIMARY KEY("event_id","artist_id")
);
--> statement-breakpoint
ALTER TABLE "artist_alerts" ADD CONSTRAINT "artist_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_alerts" ADD CONSTRAINT "artist_alerts_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_alerts" ADD CONSTRAINT "artist_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_followers" ADD CONSTRAINT "artist_followers_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_followers" ADD CONSTRAINT "artist_followers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_followers" ADD CONSTRAINT "artist_followers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_genre_id_artist_genre_lookup_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."artist_genre_lookup"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_stories" ADD CONSTRAINT "artist_stories_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_stories" ADD CONSTRAINT "artist_stories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_verifications" ADD CONSTRAINT "artist_verifications_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_verifications" ADD CONSTRAINT "artist_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_verifications" ADD CONSTRAINT "artist_verifications_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_alerts_tenant_idx" ON "artist_alerts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "artist_followers_tenant_idx" ON "artist_followers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "artist_genres_tenant_idx" ON "artist_genres" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "artist_stories_tenant_idx" ON "artist_stories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "artist_stories_expiry_idx" ON "artist_stories" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "artist_verifications_tenant_idx" ON "artist_verifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artists_slug_unique_idx" ON "artists" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "artists_tenant_idx" ON "artists" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "event_artists_tenant_idx" ON "event_artists" USING btree ("tenant_id");