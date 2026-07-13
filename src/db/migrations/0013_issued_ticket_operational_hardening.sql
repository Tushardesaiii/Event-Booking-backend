ALTER TABLE "issued_tickets"
  ADD COLUMN IF NOT EXISTS "checked_in_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "transferred_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "last_validated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_validated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "validation_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refunded_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "refunded_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

DROP INDEX IF EXISTS "issued_tickets_tenant_attendee_unique";

CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_attendee_active_idx" ON "issued_tickets" USING btree ("tenant_id", "attendee_id") WHERE ("attendee_id" IS NOT NULL AND "deleted_at" IS NULL);
CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_booking_order_id_idx" ON "issued_tickets" USING btree ("tenant_id", "booking_order_id") WHERE ("deleted_at" IS NULL);
CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_booking_order_item_id_idx" ON "issued_tickets" USING btree ("tenant_id", "booking_order_item_id") WHERE ("deleted_at" IS NULL);
CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_issued_at_idx" ON "issued_tickets" USING btree ("tenant_id", "issued_at") WHERE ("deleted_at" IS NULL);
CREATE INDEX IF NOT EXISTS "issued_tickets_tenant_status_idx" ON "issued_tickets" USING btree ("tenant_id", "status") WHERE ("deleted_at" IS NULL);