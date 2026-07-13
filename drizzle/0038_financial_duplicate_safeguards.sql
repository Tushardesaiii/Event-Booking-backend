CREATE UNIQUE INDEX IF NOT EXISTS "ledger_accounts_tenant_type_name_unique"
  ON "ledger_accounts" USING btree ("tenant_id", "type", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_account_balances_tenant_account_unique"
  ON "ledger_account_balances" USING btree ("tenant_id", "account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_locks_tenant_lock_key_unique"
  ON "ledger_locks" USING btree ("tenant_id", "lock_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_idempotency_keys_tenant_key_unique"
  ON "ledger_idempotency_keys" USING btree ("tenant_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_tenant_booking_unique"
  ON "payment_orders" USING btree ("tenant_id", "booking_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_tenant_razorpay_order_unique"
  ON "payment_orders" USING btree ("tenant_id", "razorpay_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_tenant_razorpay_payment_unique"
  ON "payment_transactions" USING btree ("tenant_id", "razorpay_payment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_tenant_razorpay_refund_unique"
  ON "payment_refunds" USING btree ("tenant_id", "razorpay_refund_id");
--> statement-breakpoint
ALTER TYPE "payment_order_status" ADD VALUE IF NOT EXISTS 'partially_captured';
--> statement-breakpoint
ALTER TYPE "payment_order_status" ADD VALUE IF NOT EXISTS 'expired';
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "captured_amount" numeric(14, 2) NOT NULL DEFAULT '0.00';
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "receipt_status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "invoice_status" text NOT NULL DEFAULT 'not_generated';
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "provider_state" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN IF NOT EXISTS "approval_status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN IF NOT EXISTS "provider_state" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_lifecycle_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "payment_order_id" uuid REFERENCES "payment_orders"("id") ON DELETE cascade,
  "payment_transaction_id" uuid REFERENCES "payment_transactions"("id") ON DELETE cascade,
  "payment_refund_id" uuid REFERENCES "payment_refunds"("id") ON DELETE cascade,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "request_id" text,
  "correlation_id" text,
  "provider_event_id" text,
  "idempotency_key" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_lifecycle_events_tenant_id_idx" ON "payment_lifecycle_events" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_lifecycle_events_entity_idx" ON "payment_lifecycle_events" USING btree ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_lifecycle_events_payment_order_id_idx" ON "payment_lifecycle_events" USING btree ("payment_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_lifecycle_events_payment_refund_id_idx" ON "payment_lifecycle_events" USING btree ("payment_refund_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_lifecycle_events_event_type_idx" ON "payment_lifecycle_events" USING btree ("event_type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_lifecycle_events_tenant_idempotency_unique" ON "payment_lifecycle_events" USING btree ("tenant_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_lifecycle_events_created_at_idx" ON "payment_lifecycle_events" USING btree ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refund_reason_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "category" text NOT NULL DEFAULT 'customer_request',
  "is_active" integer NOT NULL DEFAULT 1,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refund_reason_catalog_tenant_code_unique" ON "refund_reason_catalog" USING btree ("tenant_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_reason_catalog_tenant_id_idx" ON "refund_reason_catalog" USING btree ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "operation_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "amount" numeric(14, 2) NOT NULL DEFAULT '0.00',
  "currency" text NOT NULL DEFAULT 'INR',
  "reference_type" text NOT NULL,
  "reference_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "ledger_transaction_id" uuid REFERENCES "ledger_transactions"("id") ON DELETE set null,
  "risk_score" integer,
  "request_id" text,
  "correlation_id" text,
  "trace_id" text,
  "ip_address" text,
  "device_info" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operations_tenant_id_idx" ON "financial_operations" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operations_operation_type_idx" ON "financial_operations" USING btree ("operation_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operations_status_idx" ON "financial_operations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operations_reference_idx" ON "financial_operations" USING btree ("reference_type", "reference_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_operations_tenant_idempotency_unique" ON "financial_operations" USING btree ("tenant_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operations_created_at_idx" ON "financial_operations" USING btree ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_operation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "operation_id" uuid REFERENCES "financial_operations"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "request_id" text,
  "correlation_id" text,
  "trace_id" text,
  "previous_hash" text,
  "current_hash" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operation_events_tenant_id_idx" ON "financial_operation_events" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operation_events_operation_id_idx" ON "financial_operation_events" USING btree ("operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operation_events_event_type_idx" ON "financial_operation_events" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_operation_events_created_at_idx" ON "financial_operation_events" USING btree ("created_at");
