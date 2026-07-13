CREATE TYPE "public"."otp_purpose" AS ENUM('signup', 'login', 'password_reset', 'phone_change', 'email_change');--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "otp_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone_number" text NOT NULL,
	"otp_hash" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marketing_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"source" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"tenant_id" uuid,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"email" text,
	"phone_number" text,
	"ip_address" text,
	"user_agent" text,
	"provider" text,
	"provider_message_id" text,
	"provider_status" text,
	"provider_response" text,
	"correlation_id" text,
	"request_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_type" text NOT NULL,
	"actor_user_id" uuid,
	"phone_number" text,
	"email" text,
	"response_reference" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"template_type" text NOT NULL,
	"status" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_campaign_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"email" text NOT NULL,
	"provider_message_id" text,
	"delivery_status" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_suppressions" ALTER COLUMN "reason" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_opt_in" boolean;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_subscribers" ADD CONSTRAINT "marketing_subscribers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_request_logs" ADD CONSTRAINT "verification_request_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_deliveries" ADD CONSTRAINT "marketing_campaign_deliveries_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_deliveries" ADD CONSTRAINT "marketing_campaign_deliveries_subscriber_id_marketing_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."marketing_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_token_hash_idx" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "otp_verifications_user_id_idx" ON "otp_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_verifications_phone_number_idx" ON "otp_verifications" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "otp_verifications_expires_at_idx" ON "otp_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_subscribers_email_unique_idx" ON "marketing_subscribers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "marketing_subscribers_tenant_id_idx" ON "marketing_subscribers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "verification_events_actor_user_id_idx" ON "verification_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "verification_events_tenant_id_idx" ON "verification_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "verification_events_created_at_idx" ON "verification_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verification_events_email_idx" ON "verification_events" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_events_phone_idx" ON "verification_events" USING btree ("phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_request_logs_idempotency_key_unique_idx" ON "verification_request_logs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "verification_request_logs_created_at_idx" ON "verification_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "marketing_campaigns_tenant_id_idx" ON "marketing_campaigns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "marketing_campaigns_created_at_idx" ON "marketing_campaigns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "marketing_campaign_deliveries_campaign_id_idx" ON "marketing_campaign_deliveries" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "marketing_campaign_deliveries_subscriber_id_idx" ON "marketing_campaign_deliveries" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "marketing_campaign_deliveries_status_idx" ON "marketing_campaign_deliveries" USING btree ("delivery_status");