ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "cover_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "website" text,
  ADD COLUMN IF NOT EXISTS "email" text,
  ADD COLUMN IF NOT EXISTS "phone" text,
  ADD COLUMN IF NOT EXISTS "city" text,
  ADD COLUMN IF NOT EXISTS "state" text,
  ADD COLUMN IF NOT EXISTS "country" text,
  ADD COLUMN IF NOT EXISTS "is_verified" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT;

UPDATE "tenants"
SET
  "cover_asset_id" = COALESCE("cover_asset_id", "banner_asset_id"),
  "is_verified" = COALESCE("is_verified", "verification_status" = 'verified'),
  "is_active" = COALESCE("is_active", "status" = 'active'),
  "created_by_user_id" = COALESCE("created_by_user_id", "created_by")
WHERE
  "cover_asset_id" IS NULL
  OR "created_by_user_id" IS NULL
  OR "is_verified" IS NULL
  OR "is_active" IS NULL;

ALTER TABLE "tenant_members"
  ADD COLUMN IF NOT EXISTS "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "joined_at" timestamp with time zone NOT NULL DEFAULT now();

UPDATE "tenant_members"
SET
  "invited_by_user_id" = COALESCE("invited_by_user_id", "invited_by"),
  "joined_at" = COALESCE("joined_at", "created_at")
WHERE
  "invited_by_user_id" IS NULL
  OR "joined_at" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'tenant_member_role'
  ) THEN
    ALTER TYPE "tenant_member_role" RENAME TO "tenant_member_role_legacy";
  END IF;
END $$;

CREATE TYPE "tenant_member_role" AS ENUM ('owner', 'admin', 'manager', 'staff', 'viewer');

ALTER TABLE "tenant_members"
  ALTER COLUMN "role" TYPE "tenant_member_role"
  USING (
    CASE "role"::text
      WHEN 'owner' THEN 'owner'
      WHEN 'admin' THEN 'admin'
      WHEN 'event_manager' THEN 'manager'
      WHEN 'marketing_manager' THEN 'staff'
      WHEN 'support' THEN 'viewer'
      ELSE 'viewer'
    END
  )::"tenant_member_role";

DROP TYPE IF EXISTS "tenant_member_role_legacy";

CREATE INDEX IF NOT EXISTS "tenants_name_idx" ON "tenants" USING btree ("name");
CREATE INDEX IF NOT EXISTS "tenants_created_by_user_id_idx" ON "tenants" USING btree ("created_by_user_id");
CREATE INDEX IF NOT EXISTS "tenants_is_active_idx" ON "tenants" USING btree ("is_active");
CREATE INDEX IF NOT EXISTS "tenants_created_at_idx" ON "tenants" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "tenant_members_tenant_id_idx" ON "tenant_members" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_members_user_id_idx" ON "tenant_members" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "tenant_members_role_idx" ON "tenant_members" USING btree ("role");
CREATE INDEX IF NOT EXISTS "tenant_members_created_at_idx" ON "tenant_members" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_members_tenant_user_unique" ON "tenant_members" USING btree ("tenant_id", "user_id");
