CREATE TABLE IF NOT EXISTS "venues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "address_line_1" text NOT NULL,
  "address_line_2" text,
  "landmark" text,
  "city" text NOT NULL,
  "state" text NOT NULL,
  "country" text NOT NULL,
  "postal_code" text,
  "latitude" numeric(10, 7),
  "longitude" numeric(10, 7),
  "capacity" integer,
  "contact_email" text,
  "contact_phone" text,
  "website" text,
  "cover_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_verified" boolean NOT NULL DEFAULT false,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'venues'
      AND column_name = 'address'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'venues'
      AND column_name = 'address_line_1'
  ) THEN
    ALTER TABLE "venues" RENAME COLUMN "address" TO "address_line_1";
  END IF;
END $$;

ALTER TABLE "venues"
  ADD COLUMN IF NOT EXISTS "slug" text,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "address_line_1" text,
  ADD COLUMN IF NOT EXISTS "address_line_2" text,
  ADD COLUMN IF NOT EXISTS "landmark" text,
  ADD COLUMN IF NOT EXISTS "postal_code" text,
  ADD COLUMN IF NOT EXISTS "latitude" numeric(10, 7),
  ADD COLUMN IF NOT EXISTS "longitude" numeric(10, 7),
  ADD COLUMN IF NOT EXISTS "capacity" integer,
  ADD COLUMN IF NOT EXISTS "contact_email" text,
  ADD COLUMN IF NOT EXISTS "contact_phone" text,
  ADD COLUMN IF NOT EXISTS "website" text,
  ADD COLUMN IF NOT EXISTS "cover_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "is_verified" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

UPDATE "venues"
SET
  "slug" = COALESCE(
    "slug",
    lower(regexp_replace("name", '[^a-z0-9]+', '-', 'g')) || '-' || substr("id"::text, 1, 8)
  ),
  "is_active" = COALESCE("is_active", true),
  "is_verified" = COALESCE("is_verified", false)
WHERE "slug" IS NULL
   OR "is_active" IS NULL
   OR "is_verified" IS NULL;

UPDATE "venues" AS v
SET
  "created_by_user_id" = COALESCE(v."created_by_user_id", t."created_by_user_id"),
  "updated_by_user_id" = COALESCE(v."updated_by_user_id", t."created_by_user_id")
FROM "tenants" AS t
WHERE t."id" = v."tenant_id";

UPDATE "venues"
SET "created_by_user_id" = "updated_by_user_id"
WHERE "created_by_user_id" IS NULL;

ALTER TABLE "venues"
  ALTER COLUMN "slug" SET NOT NULL,
  ALTER COLUMN "address_line_1" SET NOT NULL,
  ALTER COLUMN "city" SET NOT NULL,
  ALTER COLUMN "state" SET NOT NULL,
  ALTER COLUMN "country" SET NOT NULL,
  ALTER COLUMN "created_by_user_id" SET NOT NULL,
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "is_verified" SET NOT NULL,
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "venues_tenant_id_idx" ON "venues" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "venues_tenant_name_idx" ON "venues" USING btree ("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "venues_tenant_city_idx" ON "venues" USING btree ("tenant_id", "city");
CREATE INDEX IF NOT EXISTS "venues_tenant_is_active_idx" ON "venues" USING btree ("tenant_id", "is_active");
CREATE INDEX IF NOT EXISTS "venues_tenant_is_verified_idx" ON "venues" USING btree ("tenant_id", "is_verified");
CREATE INDEX IF NOT EXISTS "venues_tenant_created_at_idx" ON "venues" USING btree ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "venues_slug_idx" ON "venues" USING btree ("slug");
CREATE INDEX IF NOT EXISTS "venues_city_idx" ON "venues" USING btree ("city");
CREATE INDEX IF NOT EXISTS "venues_created_at_idx" ON "venues" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "venues_tenant_slug_unique" ON "venues" USING btree ("tenant_id", "slug") WHERE "deleted_at" IS NULL;