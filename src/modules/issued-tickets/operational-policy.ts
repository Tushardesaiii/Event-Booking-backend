import type { IssuedTicketStatus } from './lifecycle.js';

export type IssuedTicketOperationalAction = 'validate' | 'check_in' | 'transfer' | 'cancel' | 'refund' | 'invalidate';

export type IssuedTicketValidationStatus =
  | 'valid'
  | 'already_checked_in'
  | 'cancelled'
  | 'invalidated'
  | 'refunded'
  | 'deleted'
  | 'tenant_mismatch'
  | 'stale_ticket'
  | 'invalid_qr'
  | 'unauthorized_scanner';

export function canValidateIssuedTicket(status: IssuedTicketStatus) {
  return status === 'issued' || status === 'transferred' || status === 'checked_in';
}

export function canCheckInIssuedTicket(status: IssuedTicketStatus) {
  return status === 'issued' || status === 'transferred' || status === 'checked_in';
}

export function canTransferIssuedTicket(status: IssuedTicketStatus) {
  return status === 'issued' || status === 'transferred';
}

export function canCancelIssuedTicket(status: IssuedTicketStatus) {
  return status === 'issued' || status === 'transferred';
}

export function canRefundIssuedTicket(status: IssuedTicketStatus) {
  return status === 'issued' || status === 'transferred' || status === 'cancelled';
}

export function canInvalidateIssuedTicket(status: IssuedTicketStatus) {
  return status === 'issued' || status === 'transferred' || status === 'cancelled';
}

export function resolveValidationOutcome(input: {
  ticketExists: boolean;
  deleted: boolean;
  tenantMatch: boolean;
  status?: IssuedTicketStatus;
  staleTicket: boolean;
  scannerAuthorized: boolean;
}): IssuedTicketValidationStatus {
  if (!input.scannerAuthorized) {
    return 'unauthorized_scanner';
  }

  if (!input.ticketExists) {
    return 'invalid_qr';
  }

  if (!input.tenantMatch) {
    return 'tenant_mismatch';
  }

  if (input.deleted) {
    return 'deleted';
  }

  if (input.staleTicket) {
    return 'stale_ticket';
  }

  switch (input.status) {
    case 'checked_in':
      return 'already_checked_in';
    case 'cancelled':
      return 'cancelled';
    case 'invalidated':
      return 'invalidated';
    case 'refunded':
      return 'refunded';
    case 'issued':
    case 'transferred':
    default:
      return 'valid';
  }
}