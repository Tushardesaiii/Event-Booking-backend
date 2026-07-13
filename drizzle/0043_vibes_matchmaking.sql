CREATE TYPE "public"."vibe_attendance" AS ENUM('going', 'not_going');--> statement-breakpoint
CREATE TYPE "public"."vibe_match_status" AS ENUM('active', 'unmatched');--> statement-breakpoint
CREATE TYPE "public"."vibe_mode" AS ENUM('solo', 'partner', 'group');--> statement-breakpoint
CREATE TYPE "public"."vibe_room_type" AS ENUM('partner', 'group');--> statement-breakpoint
CREATE TYPE "public"."vibe_swipe_decision" AS ENUM('accept', 'reject');--> statement-breakpoint
CREATE TABLE "vibe_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type" "vibe_room_type" NOT NULL,
	"room_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vibe_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vibe_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"chat_activates_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vibe_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"status" "vibe_match_status" DEFAULT 'active' NOT NULL,
	"chat_activates_at" timestamp with time zone NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vibe_participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"mode" "vibe_mode" DEFAULT 'solo' NOT NULL,
	"attendance" "vibe_attendance",
	"group_id" uuid,
	"partner_changes_used" integer DEFAULT 0 NOT NULL,
	"group_changes_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vibe_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vibe_swipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"swiper_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"decision" "vibe_swipe_decision" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vibe_chat_messages" ADD CONSTRAINT "vibe_chat_messages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_chat_messages" ADD CONSTRAINT "vibe_chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_group_members" ADD CONSTRAINT "vibe_group_members_group_id_vibe_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."vibe_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_group_members" ADD CONSTRAINT "vibe_group_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_group_members" ADD CONSTRAINT "vibe_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_groups" ADD CONSTRAINT "vibe_groups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_matches" ADD CONSTRAINT "vibe_matches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_matches" ADD CONSTRAINT "vibe_matches_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_matches" ADD CONSTRAINT "vibe_matches_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_participations" ADD CONSTRAINT "vibe_participations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_participations" ADD CONSTRAINT "vibe_participations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_profiles" ADD CONSTRAINT "vibe_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_swipes" ADD CONSTRAINT "vibe_swipes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_swipes" ADD CONSTRAINT "vibe_swipes_swiper_user_id_users_id_fk" FOREIGN KEY ("swiper_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vibe_swipes" ADD CONSTRAINT "vibe_swipes_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vibe_chat_messages_room_idx" ON "vibe_chat_messages" USING btree ("room_type","room_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vibe_group_members_group_user_unique" ON "vibe_group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "vibe_group_members_event_user_idx" ON "vibe_group_members" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "vibe_groups_event_idx" ON "vibe_groups" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vibe_matches_event_pair_unique" ON "vibe_matches" USING btree ("event_id","user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "vibe_matches_user_a_idx" ON "vibe_matches" USING btree ("user_a_id");--> statement-breakpoint
CREATE INDEX "vibe_matches_user_b_idx" ON "vibe_matches" USING btree ("user_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vibe_participations_user_event_unique" ON "vibe_participations" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "vibe_participations_event_mode_idx" ON "vibe_participations" USING btree ("event_id","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "vibe_profiles_user_id_unique" ON "vibe_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vibe_swipes_event_swiper_target_unique" ON "vibe_swipes" USING btree ("event_id","swiper_user_id","target_user_id");--> statement-breakpoint
CREATE INDEX "vibe_swipes_event_target_idx" ON "vibe_swipes" USING btree ("event_id","target_user_id");