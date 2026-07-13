CREATE TABLE IF NOT EXISTS "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
	"payment_transaction_id" uuid NOT NULL REFERENCES "payment_transactions"("id") ON DELETE restrict,
	"razorpay_dispute_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"reason" text,
	"evidence_deadline" timestamp with time zone,
	"evidence_submission" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gateway_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
	"dispute_id" uuid NOT NULL REFERENCES "payment_disputes"("id") ON DELETE cascade,
	"document_url" text NOT NULL,
	"document_type" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_runs" ADD COLUMN IF NOT EXISTS "approved_by" uuid REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "settlement_runs" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement_runs" ADD COLUMN IF NOT EXISTS "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement_runs" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_runs" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "gateway_payout_id" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "gateway_status" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "error_message" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_disputes_tenant_id_idx" ON "payment_disputes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_disputes_transaction_id_idx" ON "payment_disputes" USING btree ("payment_transaction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_disputes_razorpay_dispute_id_idx" ON "payment_disputes" USING btree ("razorpay_dispute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_disputes_status_idx" ON "payment_disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_disputes_created_at_idx" ON "payment_disputes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_dispute_evidence_tenant_id_idx" ON "payment_dispute_evidence" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_dispute_evidence_dispute_id_idx" ON "payment_dispute_evidence" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotions_tenant_id_idx" ON "promotions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotions_code_idx" ON "promotions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promotions_tenant_code_unique" ON "promotions" USING btree ("tenant_id","code");