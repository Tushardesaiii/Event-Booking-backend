CREATE TYPE "public"."moderation_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('uploading', 'processing', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"uploader_user_id" uuid,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"checksum" text,
	"blur_hash" text,
	"dominant_color" text,
	"moderation_status" "moderation_status" DEFAULT 'pending' NOT NULL,
	"processing_status" "processing_status" DEFAULT 'uploading' NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_links" ADD CONSTRAINT "media_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_links" ADD CONSTRAINT "media_links_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_tenant_id_idx" ON "media_assets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "media_assets_uploader_user_id_idx" ON "media_assets" USING btree ("uploader_user_id");--> statement-breakpoint
CREATE INDEX "media_assets_deleted_at_idx" ON "media_assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "media_assets_checksum_idx" ON "media_assets" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "media_links_tenant_id_idx" ON "media_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "media_links_media_asset_id_idx" ON "media_links" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "media_links_entity_idx" ON "media_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "media_links_role_idx" ON "media_links" USING btree ("role");