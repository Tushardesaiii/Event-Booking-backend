ALTER TYPE "public"."ledger_account_type" ADD VALUE 'PLATFORM_CASH';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'CUSTOMER_CASH';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'CUSTOMER_LIABILITY';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'ESCROW';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'ORGANIZER_PENDING';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'ORGANIZER_AVAILABLE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'ORGANIZER_PAYABLE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'PLATFORM_FEE_REVENUE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'GATEWAY_FEE_EXPENSE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'REFUND_LIABILITY';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'CHARGEBACK_RESERVE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'RESERVE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'SETTLEMENT_CLEARING';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'WITHDRAWAL_CLEARING';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'SYSTEM_ADJUSTMENT';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'FRAUD_RESERVE';--> statement-breakpoint
ALTER TYPE "public"."ledger_account_type" ADD VALUE 'SUSPENSE_ACCOUNT';--> statement-breakpoint
CREATE TABLE "ledger_account_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"debit_balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"credit_balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"ip_address" text,
	"request_id" text,
	"source" text,
	"reference" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"transaction_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payment_id" text,
	"razorpay_payment_id" text,
	"booking_id" text,
	"order_id" text,
	"withdrawal_id" text,
	"refund_id" text,
	"response_payload" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lock_key" text NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_type" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discrepancies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"last_transaction_id" uuid NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"debit_balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"credit_balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "precision" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "minor_unit" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "previous_hash" text;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "current_hash" text;--> statement-breakpoint
ALTER TABLE "ledger_account_balances" ADD CONSTRAINT "ledger_account_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_balances" ADD CONSTRAINT "ledger_account_balances_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_audit_logs" ADD CONSTRAINT "ledger_audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_audit_logs" ADD CONSTRAINT "ledger_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_idempotency_keys" ADD CONSTRAINT "ledger_idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_locks" ADD CONSTRAINT "ledger_locks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_reconciliation" ADD CONSTRAINT "ledger_reconciliation_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_snapshots" ADD CONSTRAINT "ledger_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_snapshots" ADD CONSTRAINT "ledger_snapshots_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_snapshots" ADD CONSTRAINT "ledger_snapshots_last_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("last_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_account_balances_tenant_id_idx" ON "ledger_account_balances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_account_balances_account_id_idx" ON "ledger_account_balances" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_account_balances_updated_at_idx" ON "ledger_account_balances" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ledger_audit_logs_tenant_id_idx" ON "ledger_audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_audit_logs_user_id_idx" ON "ledger_audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ledger_audit_logs_entity_idx" ON "ledger_audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ledger_audit_logs_created_at_idx" ON "ledger_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_events_tenant_id_idx" ON "ledger_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_events_status_idx" ON "ledger_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_events_created_at_idx" ON "ledger_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_tenant_id_idx" ON "ledger_idempotency_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_idempotency_key_idx" ON "ledger_idempotency_keys" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_payment_idx" ON "ledger_idempotency_keys" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_razorpay_payment_idx" ON "ledger_idempotency_keys" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_booking_idx" ON "ledger_idempotency_keys" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_order_idx" ON "ledger_idempotency_keys" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_withdrawal_idx" ON "ledger_idempotency_keys" USING btree ("withdrawal_id");--> statement-breakpoint
CREATE INDEX "ledger_idempotency_keys_refund_idx" ON "ledger_idempotency_keys" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "ledger_locks_tenant_id_idx" ON "ledger_locks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_locks_lock_key_idx" ON "ledger_locks" USING btree ("lock_key");--> statement-breakpoint
CREATE INDEX "ledger_reconciliation_tenant_id_idx" ON "ledger_reconciliation" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_reconciliation_created_at_idx" ON "ledger_reconciliation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_snapshots_tenant_id_idx" ON "ledger_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_snapshots_account_id_idx" ON "ledger_snapshots" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_snapshots_created_at_idx" ON "ledger_snapshots" USING btree ("created_at");