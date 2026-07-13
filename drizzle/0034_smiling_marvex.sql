CREATE TABLE "storage_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"owner_id" uuid,
	"module" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"checksum" text,
	"etag" text,
	"uploaded_by" uuid,
	"visibility" text DEFAULT 'private' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_objects_tenant_id_idx" ON "storage_objects" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storage_objects_owner_id_idx" ON "storage_objects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "storage_objects_module_idx" ON "storage_objects" USING btree ("module");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_objects_object_key_unique_idx" ON "storage_objects" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "storage_objects_uploaded_by_idx" ON "storage_objects" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "storage_objects_created_at_idx" ON "storage_objects" USING btree ("created_at");