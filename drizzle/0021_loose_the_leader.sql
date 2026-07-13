CREATE TABLE "organizer_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizer_social_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"logo_asset_id" uuid,
	"banner_asset_id" uuid,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_plan_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_plan_id" uuid NOT NULL,
	"user_id" uuid,
	"activity_type" text NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_plan_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_plan_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"invitee_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_plan_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"event_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"file_url" text NOT NULL,
	"file_type" text,
	"file_name" text,
	"file_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_chat_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"reply_to_message_id" uuid,
	"is_edited" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_chat_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_chat_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_plan_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"option_text" text NOT NULL,
	"event_id" uuid,
	"date_option" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_poll_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_plan_id" uuid NOT NULL,
	"question" text NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"allow_multiple_choices" boolean DEFAULT false NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizer_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"follower_user_id" uuid NOT NULL,
	"following_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"media_url" text NOT NULL,
	"media_type" text DEFAULT 'image' NOT NULL,
	"caption" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "story_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "story_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"viewer_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text NOT NULL,
	"read_at" timestamp with time zone,
	"entity_type" text,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organizer_reviews" ADD CONSTRAINT "organizer_reviews_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_reviews" ADD CONSTRAINT "organizer_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_social_links" ADD CONSTRAINT "organizer_social_links_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plan_activity" ADD CONSTRAINT "group_plan_activity_group_plan_id_group_plans_id_fk" FOREIGN KEY ("group_plan_id") REFERENCES "public"."group_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plan_activity" ADD CONSTRAINT "group_plan_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plan_invites" ADD CONSTRAINT "group_plan_invites_group_plan_id_group_plans_id_fk" FOREIGN KEY ("group_plan_id") REFERENCES "public"."group_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plan_invites" ADD CONSTRAINT "group_plan_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plan_invites" ADD CONSTRAINT "group_plan_invites_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plan_members" ADD CONSTRAINT "group_plan_members_group_plan_id_group_plans_id_fk" FOREIGN KEY ("group_plan_id") REFERENCES "public"."group_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plan_members" ADD CONSTRAINT "group_plan_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plans" ADD CONSTRAINT "group_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plans" ADD CONSTRAINT "group_plans_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plans" ADD CONSTRAINT "group_plans_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plans" ADD CONSTRAINT "group_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_plans" ADD CONSTRAINT "group_plans_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_attachments" ADD CONSTRAINT "group_chat_attachments_message_id_group_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."group_chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_members" ADD CONSTRAINT "group_chat_members_room_id_group_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."group_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_members" ADD CONSTRAINT "group_chat_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_room_id_group_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."group_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_reactions" ADD CONSTRAINT "group_chat_reactions_message_id_group_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."group_chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_reactions" ADD CONSTRAINT "group_chat_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_rooms" ADD CONSTRAINT "group_chat_rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_rooms" ADD CONSTRAINT "group_chat_rooms_group_plan_id_group_plans_id_fk" FOREIGN KEY ("group_plan_id") REFERENCES "public"."group_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_rooms" ADD CONSTRAINT "group_chat_rooms_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_rooms" ADD CONSTRAINT "group_chat_rooms_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_poll_options" ADD CONSTRAINT "event_poll_options_poll_id_event_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."event_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_poll_options" ADD CONSTRAINT "event_poll_options_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_poll_votes" ADD CONSTRAINT "event_poll_votes_poll_id_event_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."event_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_poll_votes" ADD CONSTRAINT "event_poll_votes_option_id_event_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."event_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_poll_votes" ADD CONSTRAINT "event_poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_polls" ADD CONSTRAINT "event_polls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_polls" ADD CONSTRAINT "event_polls_group_plan_id_group_plans_id_fk" FOREIGN KEY ("group_plan_id") REFERENCES "public"."group_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_polls" ADD CONSTRAINT "event_polls_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_polls" ADD CONSTRAINT "event_polls_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_follows" ADD CONSTRAINT "artist_follows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_follows" ADD CONSTRAINT "artist_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_follows" ADD CONSTRAINT "artist_follows_artist_id_users_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_follows" ADD CONSTRAINT "organizer_follows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_follows" ADD CONSTRAINT "organizer_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_follows" ADD CONSTRAINT "organizer_follows_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_user_id_users_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_following_user_id_users_id_fk" FOREIGN KEY ("following_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizer_reviews_organizer_id_idx" ON "organizer_reviews" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "organizer_reviews_reviewer_user_id_idx" ON "organizer_reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "organizer_social_links_organizer_id_idx" ON "organizer_social_links" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "organizers_tenant_id_idx" ON "organizers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizers_slug_unique" ON "organizers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizers_created_at_idx" ON "organizers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "group_plan_activity_group_plan_id_idx" ON "group_plan_activity" USING btree ("group_plan_id");--> statement-breakpoint
CREATE INDEX "group_plan_invites_group_plan_id_idx" ON "group_plan_invites" USING btree ("group_plan_id");--> statement-breakpoint
CREATE INDEX "group_plan_invites_invitee_user_id_idx" ON "group_plan_invites" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "group_plan_members_group_plan_id_idx" ON "group_plan_members" USING btree ("group_plan_id");--> statement-breakpoint
CREATE INDEX "group_plan_members_user_id_idx" ON "group_plan_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_plan_members_plan_user_unique" ON "group_plan_members" USING btree ("group_plan_id","user_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "group_plans_tenant_id_idx" ON "group_plans" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "group_plans_event_id_idx" ON "group_plans" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "group_plans_owner_user_id_idx" ON "group_plans" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "group_plans_created_at_idx" ON "group_plans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "group_chat_attachments_message_id_idx" ON "group_chat_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "group_chat_members_room_id_idx" ON "group_chat_members" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "group_chat_members_user_id_idx" ON "group_chat_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_chat_messages_room_id_idx" ON "group_chat_messages" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "group_chat_messages_sender_user_id_idx" ON "group_chat_messages" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "group_chat_messages_created_at_idx" ON "group_chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "group_chat_reactions_message_id_idx" ON "group_chat_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_chat_reactions_msg_usr_react_unique" ON "group_chat_reactions" USING btree ("message_id","user_id","reaction");--> statement-breakpoint
CREATE INDEX "group_chat_rooms_tenant_id_idx" ON "group_chat_rooms" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "group_chat_rooms_group_plan_id_idx" ON "group_chat_rooms" USING btree ("group_plan_id");--> statement-breakpoint
CREATE INDEX "event_poll_options_poll_id_idx" ON "event_poll_options" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "event_poll_options_event_id_idx" ON "event_poll_options" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_poll_votes_poll_id_idx" ON "event_poll_votes" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "event_poll_votes_option_id_idx" ON "event_poll_votes" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "event_poll_votes_user_id_idx" ON "event_poll_votes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_poll_votes_poll_usr_opt_unique" ON "event_poll_votes" USING btree ("poll_id","user_id","option_id");--> statement-breakpoint
CREATE INDEX "event_polls_tenant_id_idx" ON "event_polls" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "event_polls_group_plan_id_idx" ON "event_polls" USING btree ("group_plan_id");--> statement-breakpoint
CREATE INDEX "wishlists_tenant_id_idx" ON "wishlists" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wishlists_user_id_idx" ON "wishlists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wishlists_event_id_idx" ON "wishlists" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_tenant_user_event_unique" ON "wishlists" USING btree ("tenant_id","user_id","event_id");--> statement-breakpoint
CREATE INDEX "artist_follows_tenant_id_idx" ON "artist_follows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "artist_follows_user_id_idx" ON "artist_follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "artist_follows_artist_id_idx" ON "artist_follows" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artist_follows_tenant_user_artist_unique" ON "artist_follows" USING btree ("tenant_id","user_id","artist_id");--> statement-breakpoint
CREATE INDEX "organizer_follows_tenant_id_idx" ON "organizer_follows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organizer_follows_user_id_idx" ON "organizer_follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizer_follows_organizer_id_idx" ON "organizer_follows" USING btree ("organizer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizer_follows_tenant_user_org_unique" ON "organizer_follows" USING btree ("tenant_id","user_id","organizer_id");--> statement-breakpoint
CREATE INDEX "user_follows_tenant_id_idx" ON "user_follows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_follows_follower_id_idx" ON "user_follows" USING btree ("follower_user_id");--> statement-breakpoint
CREATE INDEX "user_follows_following_id_idx" ON "user_follows" USING btree ("following_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_follows_tenant_follower_following_unique" ON "user_follows" USING btree ("tenant_id","follower_user_id","following_user_id");--> statement-breakpoint
CREATE INDEX "stories_tenant_id_idx" ON "stories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "stories_owner_type_id_idx" ON "stories" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "stories_expires_at_idx" ON "stories" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "stories_created_at_idx" ON "stories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "story_reactions_story_id_idx" ON "story_reactions" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_reactions_user_id_idx" ON "story_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "story_replies_story_id_idx" ON "story_replies" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_replies_sender_user_id_idx" ON "story_replies" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "story_views_story_id_idx" ON "story_views" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_views_viewer_user_id_idx" ON "story_views" USING btree ("viewer_user_id");--> statement-breakpoint
CREATE INDEX "notification_preferences_tenant_id_idx" ON "notification_preferences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_tenant_user_unique" ON "notification_preferences" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_id_idx" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_at_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");