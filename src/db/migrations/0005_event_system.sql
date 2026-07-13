DO $$
BEGIN
  CREATE TYPE "event_status" AS ENUM ('draft', 'published', 'cancelled', 'completed', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "event_visibility" AS ENUM ('public', 'private', 'unlisted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "categories"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

UPDATE "categories" AS c
SET "tenant_id" = src."tenant_id"
FROM (
  SELECT DISTINCT ON (e."category_id") e."category_id", e."tenant_id"
  FROM "events" e
  WHERE e."category_id" IS NOT NULL
  ORDER BY e."category_id", e."created_at" ASC
) AS src
WHERE c."id" = src."category_id"
  AND c."tenant_id" IS NULL;

CREATE TABLE IF NOT EXISTS "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "tags"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

UPDATE "tags" AS t
SET "tenant_id" = src."tenant_id"
FROM (
  SELECT DISTINCT ON (et."tag_id") et."tag_id", e."tenant_id"
  FROM "event_tags" et
  INNER JOIN "events" e ON e."id" = et."event_id"
  ORDER BY et."tag_id", et."created_at" ASC
) AS src
WHERE t."id" = src."tag_id"
  AND t."tenant_id" IS NULL;

CREATE TABLE IF NOT EXISTS "event_series" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "timezone" text NOT NULL,
  "start_date_time" timestamp with time zone,
  "end_date_time" timestamp with time zone,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "event_series_date_range_check" CHECK (
    "start_date_time" IS NULL OR "end_date_time" IS NULL OR "end_date_time" > "start_date_time"
  )
);

ALTER TABLE "event_series"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "timezone" text,
  ADD COLUMN IF NOT EXISTS "start_date_time" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "end_date_time" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

UPDATE "event_series"
SET "timezone" = COALESCE("timezone", 'Asia/Kolkata')
WHERE "timezone" IS NULL;

ALTER TABLE "event_series"
  ALTER COLUMN "timezone" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "venue_id" uuid REFERENCES "venues"("id") ON DELETE SET NULL,
  "category_id" uuid REFERENCES "categories"("id") ON DELETE SET NULL,
  "event_series_id" uuid REFERENCES "event_series"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "short_description" text,
  "description" text,
  "start_date_time" timestamp with time zone NOT NULL,
  "end_date_time" timestamp with time zone NOT NULL,
  "timezone" text NOT NULL,
  "banner_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  "thumbnail_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  "max_capacity" integer,
  "status" "event_status" NOT NULL DEFAULT 'draft',
  "visibility" "event_visibility" NOT NULL DEFAULT 'public',
  "published_at" timestamp with time zone,
  "is_featured" boolean NOT NULL DEFAULT false,
  "meta_title" text,
  "meta_description" text,
  "terms_and_conditions" text,
  "cancellation_policy" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "events_date_range_check" CHECK ("end_date_time" > "start_date_time")
);

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "event_series_id" uuid REFERENCES "event_series"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "short_description" text,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "start_date_time" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "end_date_time" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "timezone" text,
  ADD COLUMN IF NOT EXISTS "banner_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "thumbnail_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "max_capacity" integer,
  ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "is_featured" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "meta_title" text,
  ADD COLUMN IF NOT EXISTS "meta_description" text,
  ADD COLUMN IF NOT EXISTS "terms_and_conditions" text,
  ADD COLUMN IF NOT EXISTS "cancellation_policy" text,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

UPDATE "events"
SET
  "start_date_time" = COALESCE("start_date_time", "start_at"),
  "end_date_time" = COALESCE("end_date_time", "end_at"),
  "timezone" = COALESCE("timezone", 'Asia/Kolkata'),
  "description" = COALESCE("description", "full_description"),
  "banner_asset_id" = COALESCE("banner_asset_id", "cover_asset_id"),
  "event_series_id" = COALESCE("event_series_id", "series_id"),
  "created_by_user_id" = COALESCE("created_by_user_id", "created_by"),
  "is_featured" = COALESCE("is_featured", false)
WHERE
  "start_date_time" IS NULL
  OR "end_date_time" IS NULL
  OR "timezone" IS NULL
  OR "description" IS NULL
  OR "event_series_id" IS NULL
  OR "created_by_user_id" IS NULL
  OR "is_featured" IS NULL;

ALTER TABLE "events"
  ALTER COLUMN "start_date_time" SET NOT NULL,
  ALTER COLUMN "end_date_time" SET NOT NULL,
  ALTER COLUMN "timezone" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "event_tags" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("tenant_id", "event_id", "tag_id")
);

ALTER TABLE "event_tags"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "categories_tenant_id_idx" ON "categories" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "categories_created_at_idx" ON "categories" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_unique" ON "categories" USING btree ("tenant_id", "slug") WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "tags_tenant_id_idx" ON "tags" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "tags_created_at_idx" ON "tags" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "tags_slug_unique" ON "tags" USING btree ("tenant_id", "slug") WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "event_series_tenant_id_idx" ON "event_series" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "event_series_slug_idx" ON "event_series" USING btree ("slug");
CREATE INDEX IF NOT EXISTS "event_series_start_date_time_idx" ON "event_series" USING btree ("start_date_time");
CREATE INDEX IF NOT EXISTS "event_series_created_at_idx" ON "event_series" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "event_series_tenant_slug_unique" ON "event_series" USING btree ("tenant_id", "slug") WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "events_tenant_id_idx" ON "events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "events_slug_idx" ON "events" USING btree ("slug");
CREATE INDEX IF NOT EXISTS "events_status_idx" ON "events" USING btree ("status");
CREATE INDEX IF NOT EXISTS "events_visibility_idx" ON "events" USING btree ("visibility");
CREATE INDEX IF NOT EXISTS "events_start_date_time_idx" ON "events" USING btree ("start_date_time");
CREATE INDEX IF NOT EXISTS "events_category_id_idx" ON "events" USING btree ("category_id");
CREATE INDEX IF NOT EXISTS "events_venue_id_idx" ON "events" USING btree ("venue_id");
CREATE INDEX IF NOT EXISTS "events_event_series_id_idx" ON "events" USING btree ("event_series_id");
CREATE INDEX IF NOT EXISTS "events_published_at_idx" ON "events" USING btree ("published_at");
CREATE INDEX IF NOT EXISTS "events_is_featured_idx" ON "events" USING btree ("is_featured");
CREATE INDEX IF NOT EXISTS "events_created_at_idx" ON "events" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "events_tenant_slug_unique" ON "events" USING btree ("tenant_id", "slug") WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "event_tags_tenant_id_idx" ON "event_tags" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "event_tags_event_id_idx" ON "event_tags" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "event_tags_tag_id_idx" ON "event_tags" USING btree ("tag_id");
