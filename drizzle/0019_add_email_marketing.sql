DO $$ BEGIN
 CREATE TYPE "public"."email_campaign_recipient_status" AS ENUM('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."email_campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."email_event_type" AS ENUM('sent', 'delivered', 'opened', 'clicked', 'unsubscribe', 'bounce', 'complaint');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."email_outbox_operation" AS ENUM('campaign_send', 'single_send');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."email_outbox_status" AS ENUM('pending', 'processing', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."email_subscriber_status" AS ENUM('subscribed', 'unsubscribed', 'suppressed', 'bounced');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."email_suppression_reason" AS ENUM('unsubscribe', 'bounce', 'complaint', 'manual');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"html_content" text NOT NULL,
	"text_content" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid,
	"segment_id" uuid,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"status" "email_campaign_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"audience_filters_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"filters_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"status" "email_subscriber_status" DEFAULT 'subscribed' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"status" "email_campaign_recipient_status" DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"provider_batch_id" text,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid,
	"recipient_id" uuid,
	"operation" "email_outbox_operation" DEFAULT 'campaign_send' NOT NULL,
	"provider" text DEFAULT 'brevo' NOT NULL,
	"status" "email_outbox_status" DEFAULT 'pending' NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"request_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid,
	"recipient_id" uuid,
	"provider_event_id" text NOT NULL,
	"event_type" "email_event_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid,
	"campaign_id" uuid,
	"email" text NOT NULL,
	"reason" "email_suppression_reason" NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_segment_id_email_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."email_segments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_segments" ADD CONSTRAINT "email_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_subscribers" ADD CONSTRAINT "email_subscribers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_subscribers" ADD CONSTRAINT "email_subscribers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_subscriber_id_email_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."email_subscribers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_recipient_id_email_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."email_campaign_recipients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_recipient_id_email_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."email_campaign_recipients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_subscriber_id_email_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."email_subscribers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "email_templates_tenant_id_idx" ON "email_templates" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_templates_tenant_id_is_active_idx" ON "email_templates" USING btree ("tenant_id","is_active");
--> statement-breakpoint
CREATE INDEX "email_templates_created_at_idx" ON "email_templates" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_tenant_id_name_unique" ON "email_templates" USING btree ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX "email_campaigns_tenant_id_idx" ON "email_campaigns" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_campaigns_tenant_id_status_idx" ON "email_campaigns" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "email_campaigns_scheduled_at_idx" ON "email_campaigns" USING btree ("scheduled_at");
--> statement-breakpoint
CREATE INDEX "email_campaigns_created_at_idx" ON "email_campaigns" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "email_campaigns_template_id_idx" ON "email_campaigns" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX "email_campaigns_segment_id_idx" ON "email_campaigns" USING btree ("segment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaigns_tenant_id_name_unique" ON "email_campaigns" USING btree ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX "email_segments_tenant_id_idx" ON "email_segments" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_segments_created_at_idx" ON "email_segments" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_segments_tenant_id_name_unique" ON "email_segments" USING btree ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX "email_subscribers_tenant_id_idx" ON "email_subscribers" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_subscribers_tenant_id_status_idx" ON "email_subscribers" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "email_subscribers_tenant_id_user_id_idx" ON "email_subscribers" USING btree ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX "email_subscribers_created_at_idx" ON "email_subscribers" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_subscribers_tenant_id_email_unique" ON "email_subscribers" USING btree ("tenant_id","email");
--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_tenant_id_idx" ON "email_campaign_recipients" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_campaign_id_idx" ON "email_campaign_recipients" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_campaign_id_status_idx" ON "email_campaign_recipients" USING btree ("campaign_id","status");
--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_subscriber_id_idx" ON "email_campaign_recipients" USING btree ("subscriber_id");
--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_created_at_idx" ON "email_campaign_recipients" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_recipients_campaign_id_subscriber_id_unique" ON "email_campaign_recipients" USING btree ("campaign_id","subscriber_id");
--> statement-breakpoint
CREATE INDEX "email_outbox_tenant_id_idx" ON "email_outbox" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_outbox_tenant_id_status_idx" ON "email_outbox" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "email_outbox_status_available_at_idx" ON "email_outbox" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "email_outbox_campaign_id_idx" ON "email_outbox" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX "email_outbox_recipient_id_idx" ON "email_outbox" USING btree ("recipient_id");
--> statement-breakpoint
CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_key_unique" ON "email_outbox" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "email_events_tenant_id_idx" ON "email_events" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_events_campaign_id_idx" ON "email_events" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX "email_events_recipient_id_idx" ON "email_events" USING btree ("recipient_id");
--> statement-breakpoint
CREATE INDEX "email_events_event_type_idx" ON "email_events" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX "email_events_created_at_idx" ON "email_events" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_provider_event_id_unique" ON "email_events" USING btree ("provider_event_id");
--> statement-breakpoint
CREATE INDEX "email_suppressions_tenant_id_idx" ON "email_suppressions" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "email_suppressions_tenant_id_reason_idx" ON "email_suppressions" USING btree ("tenant_id","reason");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_tenant_id_email_unique" ON "email_suppressions" USING btree ("tenant_id","email");
--> statement-breakpoint
CREATE INDEX "email_suppressions_created_at_idx" ON "email_suppressions" USING btree ("created_at");
