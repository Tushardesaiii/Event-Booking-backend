CREATE TABLE "storage_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_object_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"width" integer,
	"height" integer,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"object_key" text NOT NULL,
	"checksum" text,
	"etag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_integrity_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anomalies_found" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"repaired_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unrecoverable_assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execution_duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "active_version" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "processing_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "variant_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "scan_status" text;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "scan_provider" text;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "scan_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "scan_result" text;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "original_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_variants" ADD CONSTRAINT "storage_variants_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_variants_storage_object_id_idx" ON "storage_variants" USING btree ("storage_object_id");--> statement-breakpoint
CREATE INDEX "storage_variants_object_key_idx" ON "storage_variants" USING btree ("object_key");--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_original_id_storage_objects_id_fk" FOREIGN KEY ("original_id") REFERENCES "public"."storage_objects"("id") ON DELETE set null ON UPDATE no action;