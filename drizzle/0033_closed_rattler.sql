CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"html_content" text NOT NULL,
	"text_content" text,
	"category" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"marketing" boolean DEFAULT true NOT NULL,
	"campaign" boolean DEFAULT true NOT NULL,
	"notification" boolean DEFAULT true NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"email" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_bounces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"bounce_type" text NOT NULL,
	"bounce_sub_type" text,
	"description" text,
	"provider_message_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"complaint_type" text,
	"user_agent" text,
	"provider_message_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN "scope" text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_audit_logs" ADD CONSTRAINT "email_audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_audit_logs" ADD CONSTRAINT "email_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_bounces" ADD CONSTRAINT "email_bounces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_complaints" ADD CONSTRAINT "email_complaints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_tenant_id_idx" ON "email_deliveries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_user_id_idx" ON "email_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_recipient_email_idx" ON "email_deliveries" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "email_deliveries_created_at_idx" ON "email_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_provider_message_id_idx" ON "email_deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_preferences_tenant_id_idx" ON "email_preferences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_preferences_user_id_idx" ON "email_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_preferences_email_idx" ON "email_preferences" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "email_preferences_unsubscribe_token_idx" ON "email_preferences" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE UNIQUE INDEX "email_preferences_tenant_email_unique" ON "email_preferences" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "email_preferences_created_at_idx" ON "email_preferences" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_audit_logs_tenant_id_idx" ON "email_audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_audit_logs_user_id_idx" ON "email_audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_audit_logs_email_idx" ON "email_audit_logs" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_audit_logs_created_at_idx" ON "email_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_bounces_tenant_id_idx" ON "email_bounces" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_bounces_email_idx" ON "email_bounces" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_bounces_created_at_idx" ON "email_bounces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_complaints_tenant_id_idx" ON "email_complaints" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_complaints_email_idx" ON "email_complaints" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_complaints_created_at_idx" ON "email_complaints" USING btree ("created_at");