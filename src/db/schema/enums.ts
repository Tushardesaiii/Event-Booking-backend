import { pgEnum } from 'drizzle-orm/pg-core';

export const tenantVerificationStatusEnum = pgEnum('tenant_verification_status', [
  'pending',
  'verified',
  'rejected'
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'active',
  'suspended',
  'archived'
]);

export const tenantMemberRoleEnum = pgEnum('tenant_member_role', [
  'owner',
  'admin',
  'manager',
  'staff',
  'viewer'
]);

export const authProviderEnum = pgEnum('auth_provider', [
  'email',
  'phone',
  'google',
  'apple',
  'whatsapp',
  'magic_link'
]);

export const verificationProviderEnum = pgEnum('verification_provider', [
  'twilio_verify'
]);

export const signupVerificationStatusEnum = pgEnum('signup_verification_status', [
  'pending',
  'verified',
  'expired',
  'cancelled'
]);

export const auditActorTypeEnum = pgEnum('audit_actor_type', [
  'anonymous',
  'user',
  'system'
]);

export const auditEventTypeEnum = pgEnum('audit_event_type', [
  'signup_started',
  'otp_sent',
  'otp_resend',
  'otp_verified',
  'otp_failed',
  'signup_completed',
  'campaign_created',
  'campaign_scheduled',
  'campaign_cancelled',
  'campaign_sent',
  'storage_upload',
  'storage_delete',
  'storage_download',
  'storage_copy',
  'storage_move',
  'storage_restore',
  'storage_variant_generation'
]);

export const emailCampaignStatusEnum = pgEnum('email_campaign_status', [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'cancelled',
  'failed'
]);

export const emailSubscriberStatusEnum = pgEnum('email_subscriber_status', [
  'subscribed',
  'unsubscribed',
  'suppressed',
  'bounced'
]);

export const emailCampaignRecipientStatusEnum = pgEnum('email_campaign_recipient_status', [
  'pending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed'
]);

export const emailOutboxOperationEnum = pgEnum('email_outbox_operation', [
  'campaign_send',
  'single_send'
]);

export const emailOutboxStatusEnum = pgEnum('email_outbox_status', [
  'pending',
  'processing',
  'completed',
  'failed'
]);

export const emailEventTypeEnum = pgEnum('email_event_type', [
  'sent',
  'delivered',
  'opened',
  'clicked',
  'unsubscribe',
  'bounce',
  'complaint'
]);

export const emailSuppressionReasonEnum = pgEnum('email_suppression_reason', [
  'unsubscribe',
  'bounce',
  'complaint',
  'manual'
]);

export const verificationTokenTypeEnum = pgEnum('verification_token_type', [
  'email_verify',
  'phone_otp',
  'password_reset',
  'invite'
]);

export const eventStatusEnum = pgEnum('event_status', [
  'draft',
  'published',
  'cancelled',
  'completed',
  'archived'
]);

export const eventVisibilityEnum = pgEnum('event_visibility', [
  'public',
  'private',
  'unlisted'
]);

export const ticketStatusEnum = pgEnum('ticket_status', [
  'draft',
  'active',
  'paused',
  'sold_out',
  'archived'
]);

export const ticketVisibilityEnum = pgEnum('ticket_visibility', [
  'public',
  'hidden',
  'invite_only'
]);

export const ticketTaxBehaviorEnum = pgEnum('ticket_tax_behavior', [
  'inclusive',
  'exclusive'
]);

export const attendeeStatusEnum = pgEnum('attendee_status', [
  'pending',
  'confirmed',
  'cancelled',
  'checked_in',
  'no_show'
]);

export const bookingOrderStatusEnum = pgEnum('booking_order_status', [
  'draft',
  'pending',
  'confirmed',
  'paid',
  'completed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded'
]);

export const bookingOrderSourceEnum = pgEnum('booking_order_source', [
  'web',
  'admin',
  'mobile',
  'walk_in',
  'kiosk',
  'partner'
]);

export const issuedTicketStatusEnum = pgEnum('issued_ticket_status', [
  'issued',
  'checked_in',
  'cancelled',
  'transferred',
  'refunded',
  'invalidated'
]);

export const inventoryReservationStatusEnum = pgEnum('inventory_reservation_status', [
  'active',
  'converted',
  'expired',
  'released',
  'cancelled',
  'created',
  'locking_inventory',
  'reserved',
  'payment_pending',
  'payment_started',
  'payment_processing',
  'payment_verified',
  'converting',
  'booked',
  'failed',
  'force_released',
  'refund_pending',
  'refunded'
]);

export const inventoryEventTypeEnum = pgEnum('inventory_event_type', [
  'reservation_created',
  'reservation_expired',
  'reservation_released',
  'reservation_converted',
  'booking_confirmed',
  'inventory_adjusted',
  'refund_restored',
  'admin_override',
  'reservation_locked',
  'reservation_extended',
  'reservation_cancelled',
  'reservation_recovered',
  'payment_linked',
  'inventory_released',
  'refund_triggered',
  'inventory_reconciled'
]);

export const otpPurposeEnum = pgEnum('otp_purpose', [
  'signup',
  'login',
  'password_reset',
  'phone_change',
  'email_change'
]);
