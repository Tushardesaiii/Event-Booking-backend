import { z } from 'zod';

export const consumerCreateBookingSchema = z.object({
  eventId: z.string().uuid(),
  // The specific event date the buyer picked (optional; defaults to the event's
  // sole/first date on the backend when omitted).
  eventDateId: z.string().uuid().nullable().optional(),
  items: z
    .array(
      z.object({
        ticketTypeId: z.string().uuid(),
        quantity: z.coerce.number().int().positive().max(50),
      }),
    )
    .min(1)
    .max(20),
});

export const consumerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const consumerBookingParamsSchema = z.object({
  orderNumber: z.string().trim().min(1).max(64),
});

export const consumerUpdateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
    city: z.string().trim().min(1).max(120).nullable().optional(),
    gender: z.enum(['male', 'female', 'non-binary', 'undisclosed']).nullable().optional(),
    dateOfBirth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD')
      .nullable()
      .optional(),
    interests: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    bio: z.string().trim().max(1000).nullable().optional(),
    // A preset avatar URL (or null to clear). Uploaded images use POST /consumer/avatar.
    avatarUrl: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const consumerAvatarUploadSchema = z.object({
  // base64-encoded image, optionally as a data URI ("data:image/jpeg;base64,...").
  image: z.string().min(16),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional().default('image/jpeg'),
});

const notificationBooleanish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  });

export const consumerNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  isRead: notificationBooleanish,
});

export const consumerNotificationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const consumerTrustedContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        relation: z.string().trim().max(60).optional(),
        phone: z.string().trim().min(5).max(32),
      }),
    )
    .max(20),
});

export const consumerTicketsQuerySchema = z.object({
  bookingId: z.string().uuid().optional(),
});

export const consumerRefundSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
  refundTo: z.enum(['wallet', 'original']).optional().default('original'),
});

export const consumerWalletRechargeSchema = z.object({
  amount: z.coerce.number().positive().max(100000),
});

export const consumerWalletVerifySchema = z.object({
  razorpayOrderId: z.string().trim().min(1),
  razorpayPaymentId: z.string().trim().min(1),
  razorpaySignature: z.string().trim().min(1),
});

export const consumerRefundIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type ConsumerTicketsQuery = z.infer<typeof consumerTicketsQuerySchema>;
export type ConsumerRefundInput = z.infer<typeof consumerRefundSchema>;
export type ConsumerRefundIdParams = z.infer<typeof consumerRefundIdParamsSchema>;
export type ConsumerCreateBookingInput = z.infer<typeof consumerCreateBookingSchema>;
export type ConsumerListQuery = z.infer<typeof consumerListQuerySchema>;
export type ConsumerBookingParams = z.infer<typeof consumerBookingParamsSchema>;
export type ConsumerNotificationsQuery = z.infer<typeof consumerNotificationsQuerySchema>;
export type ConsumerNotificationIdParams = z.infer<typeof consumerNotificationIdParamsSchema>;
export type ConsumerWalletRechargeInput = z.infer<typeof consumerWalletRechargeSchema>;
export type ConsumerWalletVerifyInput = z.infer<typeof consumerWalletVerifySchema>;

