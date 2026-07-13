ALTER TYPE "public"."inventory_event_type" ADD VALUE 'reservation_locked';--> statement-breakpoint
ALTER TYPE "public"."inventory_event_type" ADD VALUE 'reservation_extended';--> statement-breakpoint
ALTER TYPE "public"."inventory_event_type" ADD VALUE 'reservation_cancelled';--> statement-breakpoint
ALTER TYPE "public"."inventory_event_type" ADD VALUE 'reservation_recovered';--> statement-breakpoint
ALTER TYPE "public"."inventory_event_type" ADD VALUE 'payment_linked';--> statement-breakpoint
ALTER TYPE "public"."inventory_event_type" ADD VALUE 'inventory_released';--> statement-breakpoint
ALTER TYPE "public"."inventory_event_type" ADD VALUE 'refund_triggered';--> statement-breakpoint
ALTER TYPE "public"."inventory_event_type" ADD VALUE 'inventory_reconciled';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'created';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'locking_inventory';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'reserved';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'payment_pending';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'payment_started';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'payment_processing';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'payment_verified';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'converting';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'booked';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'force_released';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'refund_pending';--> statement-breakpoint
ALTER TYPE "public"."inventory_reservation_status" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD COLUMN "extension_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD COLUMN "max_extensions" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;