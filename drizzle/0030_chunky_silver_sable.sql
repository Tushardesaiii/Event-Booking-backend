CREATE TYPE "public"."payment_order_status" AS ENUM('pending', 'authorized', 'captured', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_order_id" uuid NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_order_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_transaction_id" uuid NOT NULL,
	"razorpay_refund_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_order_id" uuid NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"gateway_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_booking_order_id_booking_orders_id_fk" FOREIGN KEY ("booking_order_id") REFERENCES "public"."booking_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_orders_tenant_id_idx" ON "payment_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_orders_booking_order_id_idx" ON "payment_orders" USING btree ("booking_order_id");--> statement-breakpoint
CREATE INDEX "payment_orders_razorpay_order_id_idx" ON "payment_orders" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE INDEX "payment_orders_status_idx" ON "payment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payment_refunds_tenant_id_idx" ON "payment_refunds" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_payment_transaction_id_idx" ON "payment_refunds" USING btree ("payment_transaction_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_razorpay_refund_id_idx" ON "payment_refunds" USING btree ("razorpay_refund_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_created_at_idx" ON "payment_refunds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payment_transactions_tenant_id_idx" ON "payment_transactions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_payment_order_id_idx" ON "payment_transactions" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_razorpay_payment_id_idx" ON "payment_transactions" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_created_at_idx" ON "payment_transactions" USING btree ("created_at");