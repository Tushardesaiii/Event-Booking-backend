DO $$
BEGIN
  CREATE TYPE "attendee_status" AS ENUM ('pending', 'confirmed', 'cancelled', 'checked_in', 'no_show');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "attendees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE RESTRICT,
  "ticket_type_id" uuid NOT NULL REFERENCES "ticket_types"("id") ON DELETE RESTRICT,
  "booking_order_id" uuid,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "gender" text,
  "date_of_birth" date,
  "city" text,
  "state" text,
  "country" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "notes" text,
  "checked_in_at" timestamp with time zone,
  "checked_in_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" "attendee_status" NOT NULL DEFAULT 'pending',
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "attendees_checked_in_requires_status" CHECK (
    ("checked_in_at" IS NULL AND "checked_in_by_user_id" IS NULL)
    OR "status" = 'checked_in'
  ),
  CONSTRAINT "attendees_checked_in_fields_required" CHECK (
    "status" <> 'checked_in'
    OR ("checked_in_at" IS NOT NULL AND "checked_in_by_user_id" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "attendees_tenant_id_idx" ON "attendees" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "attendees_event_id_idx" ON "attendees" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "attendees_ticket_type_id_idx" ON "attendees" USING btree ("ticket_type_id");
CREATE INDEX IF NOT EXISTS "attendees_status_idx" ON "attendees" USING btree ("status");
CREATE INDEX IF NOT EXISTS "attendees_checked_in_at_idx" ON "attendees" USING btree ("checked_in_at");
CREATE INDEX IF NOT EXISTS "attendees_email_idx" ON "attendees" USING btree ("email");
CREATE INDEX IF NOT EXISTS "attendees_phone_idx" ON "attendees" USING btree ("phone");
CREATE INDEX IF NOT EXISTS "attendees_created_at_idx" ON "attendees" USING btree ("created_at");