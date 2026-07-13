import { hasPermission } from '../lib/permissions.js';
import type { TenantMemberRole } from '../types/auth.js';

export function canIssueTickets(role?: TenantMemberRole | null) {
  return hasPermission(role, 'ticket.issue');
}

export function canReadIssuedTickets(role?: TenantMemberRole | null) {
  return hasPermission(role, 'ticket.read');
}

export function canInvalidateTickets(role?: TenantMemberRole | null) {
  return hasPermission(role, 'ticket.invalidate');
}

export function canCancelIssuedTickets(role?: TenantMemberRole | null) {
  return hasPermission(role, 'ticket.cancel');
}

export function canTransferIssuedTickets(role?: TenantMemberRole | null) {
  return hasPermission(role, 'ticket.transfer');
}

export function canCheckInTickets(role?: TenantMemberRole | null) {
  return hasPermission(role, 'ticket.checkin');
}