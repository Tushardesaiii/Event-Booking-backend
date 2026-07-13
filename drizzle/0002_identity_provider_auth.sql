ALTER TABLE "users" DROP COLUMN IF EXISTS "email";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";

DO $$
BEGIN
  CREATE TYPE "auth_provider" AS ENUM ('email', 'phone', 'google', 'apple', 'whatsapp', 'magic_link');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "verification_token_type" AS ENUM ('email_verify', 'phone_otp', 'password_reset', 'invite');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "auth_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" "auth_provider" NOT NULL,
  "email" text,
  "phone" text,
  "password_hash" text,
  "provider_account_id" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "is_verified" boolean DEFAULT false NOT NULL,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "verification_token_type" NOT NULL,
  "target" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_accounts_user_id_idx" ON "auth_accounts" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "auth_accounts_provider_idx" ON "auth_accounts" USING btree ("provider");
CREATE INDEX IF NOT EXISTS "auth_accounts_email_idx" ON "auth_accounts" USING btree ("email");
CREATE INDEX IF NOT EXISTS "auth_accounts_phone_idx" ON "auth_accounts" USING btree ("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_provider_account_unique" ON "auth_accounts" USING btree ("provider", "provider_account_id") WHERE "provider_account_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_primary_unique" ON "auth_accounts" USING btree ("user_id") WHERE "is_primary" = true;
CREATE INDEX IF NOT EXISTS "verification_tokens_user_id_idx" ON "verification_tokens" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "verification_tokens_type_idx" ON "verification_tokens" USING btree ("type");
CREATE INDEX IF NOT EXISTS "verification_tokens_target_idx" ON "verification_tokens" USING btree ("target");
CREATE INDEX IF NOT EXISTS "verification_tokens_expires_at_idx" ON "verification_tokens" USING btree ("expires_at");