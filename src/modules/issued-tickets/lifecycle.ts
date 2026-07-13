import { invalidTicketStatus } from '../../lib/errors.js';

export const ISSUED_TICKET_STATUSES = ['issued', 'checked_in', 'cancelled', 'transferred', 'refunded', 'invalidated'] as const;
export type IssuedTicketStatus = (typeof ISSUED_TICKET_STATUSES)[number];

export const ISSUED_TICKET_ALLOWED_TRANSITIONS: Record<IssuedTicketStatus, readonly IssuedTicketStatus[]> = {
  issued: ['checked_in', 'cancelled', 'transferred', 'refunded', 'invalidated'],
  checked_in: [],
  cancelled: [],
  transferred: ['checked_in', 'cancelled', 'refunded', 'invalidated'],
  refunded: [],
  invalidated: []
};

export function isTerminalIssuedTicketStatus(status: IssuedTicketStatus) {
  return status === 'cancelled' || status === 'refunded' || status === 'invalidated';
}

export function validateIssuedTicketTransition(currentStatus: IssuedTicketStatus, nextStatus: IssuedTicketStatus) {
  const allowed = ISSUED_TICKET_ALLOWED_TRANSITIONS[currentStatus];

  if (currentStatus !== nextStatus && !allowed.includes(nextStatus)) {
    throw invalidTicketStatus(`Cannot transition issued ticket from ${currentStatus} to ${nextStatus}`);
  }
}

export function resolveTicketStatusFromBookingStatus(status: 'draft' | 'pending' | 'confirmed' | 'paid' | 'completed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded'): IssuedTicketStatus | null {
  switch (status) {
    case 'confirmed':
    case 'paid':
    case 'completed':
      return 'issued';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'invalidated';
    case 'refunded':
      return 'refunded';
    case 'partially_refunded':
      return 'refunded';
    default:
      return null;
  }
}
