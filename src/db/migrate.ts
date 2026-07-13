import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { db, sql } from './client.js';

async function runMigration() {
  try {
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'campaign_created'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'campaign_scheduled'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'campaign_cancelled'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'campaign_sent'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'storage_upload'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'storage_delete'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'storage_download'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'storage_copy'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'storage_move'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'storage_restore'`;
    await sql`ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'storage_variant_generation'`;
    console.log('Successfully checked and updated audit_event_type enums.');
  } catch (error) {
    console.log('Skipping audit_event_type enum updates (they might already exist):', error);
  }

  try {
    // Organizer-authored FAQ for events (array of {question, answer}). Additive,
    // nullable — safe to run repeatedly.
    await sql`ALTER TABLE "public"."events" ADD COLUMN IF NOT EXISTS "faq" jsonb`;
    console.log('Successfully ensured events.faq column exists.');
  } catch (error) {
    console.log('Skipping events.faq column add (it might already exist):', error);
  }
  try {
    // Platform verification gate for artists. Adding the column defaults EXISTING
    // rows to 'verified' so live directory data / lineups aren't disrupted, then we
    // flip the column default to 'pending' so NEW artists require superadmin review.
    // Both statements are idempotent (ADD COLUMN IF NOT EXISTS + SET DEFAULT).
    await sql`ALTER TABLE "public"."artists" ADD COLUMN IF NOT EXISTS "verification_status" "artist_verification_status" NOT NULL DEFAULT 'verified'`;
    await sql`ALTER TABLE "public"."artists" ALTER COLUMN "verification_status" SET DEFAULT 'pending'`;
    console.log('Successfully ensured artists.verification_status column exists.');
  } catch (error) {
    console.log('Skipping artists.verification_status column add (it might already exist):', error);
  }
  try {
    // Multiple selectable dates per event. `event_dates` holds the concrete,
    // bookable occurrences; bookings + issued tickets carry the chosen one.
    // All statements are idempotent (IF NOT EXISTS / guarded backfill).
    await sql`CREATE TABLE IF NOT EXISTS "event_dates" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
      "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
      "start_date_time" timestamptz NOT NULL,
      "end_date_time" timestamptz NOT NULL,
      "display_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS "event_dates_event_id_idx" ON "event_dates" ("event_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "event_dates_tenant_id_idx" ON "event_dates" ("tenant_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "event_dates_event_order_idx" ON "event_dates" ("event_id","display_order")`;
    // One occurrence per existing event from its current range, so nothing loses its date.
    await sql`INSERT INTO "event_dates" ("tenant_id","event_id","start_date_time","end_date_time","display_order")
      SELECT e."tenant_id", e."id", e."start_date_time", e."end_date_time", 0
      FROM "events" e
      WHERE NOT EXISTS (SELECT 1 FROM "event_dates" d WHERE d."event_id" = e."id")`;
    await sql`ALTER TABLE "booking_orders" ADD COLUMN IF NOT EXISTS "event_date_id" uuid REFERENCES "event_dates"("id")`;
    await sql`ALTER TABLE "issued_tickets" ADD COLUMN IF NOT EXISTS "event_date_id" uuid REFERENCES "event_dates"("id")`;
    console.log('Successfully ensured event_dates table + booking/ticket links exist.');
  } catch (error) {
    console.log('Skipping event_dates setup (it might already exist):', error);
  }
  try {
    // Global superadmin config (single row). Holds the platform-wide convenience
    // fee applied to every booking. Idempotent: create-if-missing + seed one row.
    await sql`CREATE TABLE IF NOT EXISTS "platform_settings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "singleton" boolean NOT NULL DEFAULT true,
      "convenience_fee_bps" integer NOT NULL DEFAULT 900,
      "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_singleton_unique" ON "platform_settings" ("singleton")`;
    await sql`INSERT INTO "platform_settings" ("singleton","convenience_fee_bps")
      SELECT true, 900 WHERE NOT EXISTS (SELECT 1 FROM "platform_settings")`;
    console.log('Successfully ensured platform_settings table + default row exist.');
  } catch (error) {
    console.log('Skipping platform_settings setup (it might already exist):', error);
  }
  try {
    // Consumer likes on events (cross-tenant). The public like count is derived
    // from these rows; a user can like an event at most once. Idempotent.
    await sql`CREATE TABLE IF NOT EXISTS "event_likes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
      "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS "event_likes_event_user_unique" ON "event_likes" ("event_id","user_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "event_likes_event_id_idx" ON "event_likes" ("event_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "event_likes_user_id_idx" ON "event_likes" ("user_id")`;
    console.log('Successfully ensured event_likes table exists.');
  } catch (error) {
    console.log('Skipping event_likes setup (it might already exist):', error);
  }
  try {
    // Optional social handles on a user's vibe profile (Instagram / Snapchat),
    // linked during vibe onboarding and shown to matches/squad-mates. Additive,
    // nullable — safe to run repeatedly.
    await sql`ALTER TABLE "vibe_profiles" ADD COLUMN IF NOT EXISTS "instagram" text`;
    await sql`ALTER TABLE "vibe_profiles" ADD COLUMN IF NOT EXISTS "snapchat" text`;
    console.log('Successfully ensured vibe_profiles social handle columns exist.');
  } catch (error) {
    console.log('Skipping vibe_profiles social columns add (they might already exist):', error);
  }

  await migrate(db, { migrationsFolder: './drizzle' });
  await sql.end();
}

runMigration()
  .then(() => {
    console.log('Migrations completed successfully.');
  })
  .catch(async (error) => {
    console.error('Migration failed:', error);
    await sql.end();
    process.exit(1);
  });
