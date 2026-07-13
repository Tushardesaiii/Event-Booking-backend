ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;

UPDATE "users"
SET "password_hash" = COALESCE("password_hash", '')
WHERE "password_hash" IS NULL;

ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "refresh_token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "user_agent" text,
  "ip_address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");