CREATE TABLE "artist_story_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" varchar(50) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_story_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"viewer_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_story_reactions" ADD CONSTRAINT "artist_story_reactions_story_id_artist_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."artist_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_story_reactions" ADD CONSTRAINT "artist_story_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_story_reactions" ADD CONSTRAINT "artist_story_reactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_story_views" ADD CONSTRAINT "artist_story_views_story_id_artist_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."artist_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_story_views" ADD CONSTRAINT "artist_story_views_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_story_views" ADD CONSTRAINT "artist_story_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_story_reactions_story_idx" ON "artist_story_reactions" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "artist_story_reactions_user_idx" ON "artist_story_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "artist_story_reactions_tenant_idx" ON "artist_story_reactions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "artist_story_views_story_idx" ON "artist_story_views" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "artist_story_views_viewer_idx" ON "artist_story_views" USING btree ("viewer_user_id");--> statement-breakpoint
CREATE INDEX "artist_story_views_tenant_idx" ON "artist_story_views" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "artist_alerts_artist_idx" ON "artist_alerts" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "artist_followers_user_idx" ON "artist_followers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "artist_stories_artist_idx" ON "artist_stories" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "artists_deleted_at_idx" ON "artists" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "event_artists_artist_idx" ON "event_artists" USING btree ("artist_id");