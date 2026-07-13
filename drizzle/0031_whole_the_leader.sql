ALTER TYPE "public"."payment_order_status" ADD VALUE 'created' BEFORE 'pending';--> statement-breakpoint
ALTER TYPE "public"."payment_order_status" ADD VALUE 'partially_refunded' BEFORE 'refunded';--> statement-breakpoint
CREATE TABLE "payment_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"score" integer NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"razorpay_event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_transaction_id" uuid,
	"razorpay_payment_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"discrepancy_type" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_events" ADD CONSTRAINT "payment_risk_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_events" ADD CONSTRAINT "payment_risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_audit_logs_tenant_id_idx" ON "payment_audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_audit_logs_actor_id_idx" ON "payment_audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "payment_audit_logs_entity_idx" ON "payment_audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "payment_audit_logs_action_idx" ON "payment_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "payment_audit_logs_created_at_idx" ON "payment_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payment_risk_events_tenant_id_idx" ON "payment_risk_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_risk_events_user_id_idx" ON "payment_risk_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_risk_events_created_at_idx" ON "payment_risk_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_event_type_idx" ON "payment_webhook_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_received_at_idx" ON "payment_webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_tenant_id_idx" ON "reconciliation_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_transaction_id_idx" ON "reconciliation_reports" USING btree ("payment_transaction_id");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_razorpay_payment_idx" ON "reconciliation_reports" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_discrepancy_type_idx" ON "reconciliation_reports" USING btree ("discrepancy_type");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_created_at_idx" ON "reconciliation_reports" USING btree ("created_at");