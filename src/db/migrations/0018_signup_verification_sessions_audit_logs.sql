ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_number" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;

DO $$ BEGIN
  CREATE TYPE "verification_provider" AS ENUM ('twilio_verify');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "signup_verification_status" AS ENUM ('pending', 'verified', 'expired', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "audit_actor_type" AS ENUM ('anonymous', 'user', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "audit_event_type" AS ENUM ('signup_started', 'otp_sent', 'otp_resend', 'otp_verified', 'otp_failed', 'signup_completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "signup_verification_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone_number" text NOT NULL,
  "email" text NOT NULL,
  "username" text NOT NULL,
  "full_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "verification_provider" "verification_provider" NOT NULL DEFAULT 'twilio_verify',
  "verification_sid" text,
  "status" "signup_verification_status" NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "verified_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" "audit_event_type" NOT NULL,
  "actor_type" "audit_actor_type" NOT NULL DEFAULT 'anonymous',
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "entity_type" text,
  "entity_id" text,
  "phone_number" text,
  "email" text,
  "username" text,
  "correlation_id" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_number_unique" ON "users" USING btree ("phone_number");

CREATE INDEX IF NOT EXISTS "signup_verification_sessions_phone_number_idx" ON "signup_verification_sessions" USING btree ("phone_number");
CREATE INDEX IF NOT EXISTS "signup_verification_sessions_email_idx" ON "signup_verification_sessions" USING btree ("email");
CREATE INDEX IF NOT EXISTS "signup_verification_sessions_status_idx" ON "signup_verification_sessions" USING btree ("status");
CREATE INDEX IF NOT EXISTS "signup_verification_sessions_expires_at_idx" ON "signup_verification_sessions" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "signup_verification_sessions_username_idx" ON "signup_verification_sessions" USING btree ("username");

CREATE INDEX IF NOT EXISTS "audit_logs_event_type_idx" ON "audit_logs" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_phone_number_idx" ON "audit_logs" USING btree ("phone_number");
CREATE INDEX IF NOT EXISTS "audit_logs_ip_address_idx" ON "audit_logs" USING btree ("ip_address");
CREATE INDEX IF NOT EXISTS "audit_logs_correlation_id_idx" ON "audit_logs" USING btree ("correlation_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");