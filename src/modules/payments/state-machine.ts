import { badRequest } from '../../lib/errors.js';

export type PaymentState =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'partially_captured'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'partially_refunded'
  | 'refunded';

const ALLOWED_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  created: ['pending', 'authorized', 'partially_captured', 'captured', 'failed', 'cancelled', 'expired'],
  pending: ['authorized', 'partially_captured', 'captured', 'failed', 'cancelled', 'expired'],
  authorized: ['partially_captured', 'captured', 'failed', 'cancelled', 'expired'],
  partially_captured: ['partially_captured', 'captured', 'failed', 'cancelled', 'expired'],
  captured: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
  refunded: [],
  failed: [],
  cancelled: [],
  expired: []
};

/**
 * Validates a payment order status transition.
 * Throws a badRequest exception if the transition is illegal.
 */
export function validatePaymentStateTransition(from: PaymentState, to: PaymentState) {
  if (from === to) {
    return; // No-op is always allowed
  }

  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw badRequest(`Illegal payment state transition from '${from}' to '${to}'`);
  }
}
