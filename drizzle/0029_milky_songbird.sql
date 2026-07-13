CREATE TYPE "public"."virus_scan_status" AS ENUM('pending', 'clean', 'infected');--> statement-breakpoint
ALTER TYPE "public"."moderation_status" ADD VALUE 'flagged';--> statement-breakpoint
ALTER TYPE "public"."moderation_status" ADD VALUE 'under_review';--> statement-breakpoint
CREATE TABLE "tenant_storage_quotas" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"max_storage_bytes" bigint DEFAULT 10737418240 NOT NULL,
	"current_storage_bytes" bigint DEFAULT 0 NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_storage_quotas" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"max_storage_bytes" bigint DEFAULT 1073741824 NOT NULL,
	"current_storage_bytes" bigint DEFAULT 0 NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_storage_quotas_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "viewer_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "cover_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "moderated_by" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "moderation_reason" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "moderation_history" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "scan_status" "virus_scan_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "scan_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "original_uploader_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "current_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_storage_quotas" ADD CONSTRAINT "tenant_storage_quotas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_quotas" ADD CONSTRAINT "user_storage_quotas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_quotas" ADD CONSTRAINT "user_storage_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_original_uploader_id_users_id_fk" FOREIGN KEY ("original_uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_current_owner_id_users_id_fk" FOREIGN KEY ("current_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;