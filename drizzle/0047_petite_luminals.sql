CREATE TABLE "user_wallet_recharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"razorpay_payment_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_wallet_recharges" ADD CONSTRAINT "user_wallet_recharges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallet_transactions" ADD CONSTRAINT "user_wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallet_transactions" ADD CONSTRAINT "user_wallet_transactions_wallet_id_user_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."user_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_wallet_recharges_user_id_idx" ON "user_wallet_recharges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_wallet_recharges_razorpay_order_id_idx" ON "user_wallet_recharges" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE INDEX "user_wallet_recharges_status_idx" ON "user_wallet_recharges" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_wallet_recharges_created_at_idx" ON "user_wallet_recharges" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_wallet_transactions_user_id_idx" ON "user_wallet_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_wallet_transactions_wallet_id_idx" ON "user_wallet_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "user_wallet_transactions_reference_idx" ON "user_wallet_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "user_wallet_transactions_created_at_idx" ON "user_wallet_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_wallets_user_id_unique" ON "user_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_wallets_user_id_idx" ON "user_wallets" USING btree ("user_id");