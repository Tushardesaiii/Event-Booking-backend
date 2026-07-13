import { z } from 'zod';

export const createOrderSchema = z.object({
  bookingOrderId: z.string().uuid('Invalid bookingOrderId format').optional(),
  bookingId: z.string().uuid('Invalid bookingId format').optional()
}).refine((data) => data.bookingOrderId || data.bookingId, {
  message: 'Either bookingOrderId or bookingId must be provided',
  path: ['bookingOrderId']
});

export const captureSchema = z.object({
  razorpayPaymentId: z.string().trim().min(1, 'razorpayPaymentId is required'),
  amount: z.coerce.number().positive('amount must be positive'),
  currency: z.string().trim().default('INR')
});

export const refundSchema = z.object({
  paymentTransactionId: z.string().uuid('Invalid paymentTransactionId format'),
  amount: z.coerce.number().positive('amount must be positive').optional(),
  reason: z.string().trim().optional()
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().trim().min(1).optional(),
  razorpayPaymentId: z.string().trim().min(1).optional(),
  razorpaySignature: z.string().trim().min(1).optional(),
  razorpay_order_id: z.string().trim().min(1).optional(),
  razorpay_payment_id: z.string().trim().min(1).optional(),
  razorpay_signature: z.string().trim().min(1).optional(),
  reservationId: z.string().trim().uuid().optional(),
  reservationToken: z.string().trim().min(1).optional(),
  // Optional delivery email captured at checkout (consumer flow) — used only to
  // send the booking confirmation email; ignored by organizer/staff callers.
  email: z.string().trim().email().max(254).optional()
}).superRefine((data, ctx) => {
  const orderId = data.razorpayOrderId || data.razorpay_order_id;
  const paymentId = data.razorpayPaymentId || data.razorpay_payment_id;
  const signature = data.razorpaySignature || data.razorpay_signature;

  if (!orderId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'razorpayOrderId or razorpay_order_id is required',
      path: ['razorpayOrderId']
    });
  }
  if (!paymentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'razorpayPaymentId or razorpay_payment_id is required',
      path: ['razorpayPaymentId']
    });
  }
  if (!signature) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'razorpaySignature or razorpay_signature is required',
      path: ['razorpaySignature']
    });
  }
});

export const customerRefundSchema = z.object({
  bookingOrderId: z.string().uuid('Invalid bookingOrderId format'),
  reason: z.string().trim().optional()
});

export const requestWithdrawalSchema = z.object({
  organizerId: z.string().uuid('Invalid organizerId format'),
  amount: z.coerce.number().positive('amount must be positive')
});

export const processWithdrawalSchema = z.object({
  status: z.enum(['approved', 'completed', 'failed', 'rejected'])
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CaptureInput = z.infer<typeof captureSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type CustomerRefundInput = z.infer<typeof customerRefundSchema>;
export type RequestWithdrawalInput = z.infer<typeof requestWithdrawalSchema>;
export type ProcessWithdrawalInput = z.infer<typeof processWithdrawalSchema>;
