import { badRequest } from '../../lib/errors.js';

export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['pending', 'confirmed', 'paid', 'completed', 'cancelled', 'expired'],
  pending: ['confirmed', 'paid', 'cancelled', 'expired'],
  confirmed: ['paid', 'completed', 'cancelled', 'refunded', 'partially_refunded'],
  paid: ['confirmed', 'completed', 'cancelled', 'expired'],
  completed: ['refunded', 'partially_refunded'],
  cancelled: [],
  expired: [],
  refunded: ['partially_refunded'],
  partially_refunded: []
};

export function validateTransition(currentStatus: string, nextStatus: string) {
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];

  if (currentStatus !== nextStatus && !allowed.includes(nextStatus)) {
    throw badRequest(`Cannot transition booking order from ${currentStatus} to ${nextStatus}`);
  }
}

export function isTerminalStatus(status: string) {
  return ['cancelled', 'expired', 'refunded', 'partially_refunded'].includes(status);
}

export function shouldReleaseInventoryOnTransition(currentStatus: string, nextStatus: string) {
  // Release when moving from a non-terminal to a terminal state.
  return !isTerminalStatus(currentStatus) && isTerminalStatus(nextStatus);
}

export default { ALLOWED_TRANSITIONS, validateTransition, isTerminalStatus, shouldReleaseInventoryOnTransition };
