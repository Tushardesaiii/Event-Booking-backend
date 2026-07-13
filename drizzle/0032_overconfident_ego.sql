CREATE TYPE "public"."ledger_account_type" AS ENUM('PLATFORM_ESCROW', 'PLATFORM_REVENUE', 'ORGANIZER_BALANCE', 'CUSTOMER_REFUNDS', 'TAX_PAYABLE', 'PAYMENT_GATEWAY_CLEARING');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'approved', 'processing', 'completed', 'failed', 'rejected');--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"ledger_transaction_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"direction" "ledger_entry_direction" NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transaction_type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizer_wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizer_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"available_balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"pending_balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"withdrawn_balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text NOT NULL,
	"discrepancies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_wallet_transactions" ADD CONSTRAINT "organizer_wallet_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_wallet_transactions" ADD CONSTRAINT "organizer_wallet_transactions_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_wallet_transactions" ADD CONSTRAINT "organizer_wallet_transactions_wallet_id_organizer_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."organizer_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_wallets" ADD CONSTRAINT "organizer_wallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_wallets" ADD CONSTRAINT "organizer_wallets_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_runs" ADD CONSTRAINT "settlement_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_accounts_tenant_id_idx" ON "ledger_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_accounts_type_idx" ON "ledger_accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ledger_accounts_status_idx" ON "ledger_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_id_idx" ON "ledger_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_id_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_ledger_transaction_id_idx" ON "ledger_entries" USING btree ("ledger_transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_created_at_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_transactions_tenant_id_idx" ON "ledger_transactions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_reference_idx" ON "ledger_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_created_at_idx" ON "ledger_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "organizer_wallet_transactions_tenant_id_idx" ON "organizer_wallet_transactions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organizer_wallet_transactions_organizer_id_idx" ON "organizer_wallet_transactions" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "organizer_wallet_transactions_wallet_id_idx" ON "organizer_wallet_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "organizer_wallet_transactions_reference_idx" ON "organizer_wallet_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "organizer_wallet_transactions_created_at_idx" ON "organizer_wallet_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "organizer_wallets_tenant_id_idx" ON "organizer_wallets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organizer_wallets_organizer_id_idx" ON "organizer_wallets" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "settlement_runs_tenant_id_idx" ON "settlement_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "settlement_runs_created_at_idx" ON "settlement_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_tenant_id_idx" ON "withdrawal_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_organizer_id_idx" ON "withdrawal_requests" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests" USING btree ("status");