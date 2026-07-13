import { hasPermission } from '../lib/permissions.js';
import type { TenantMemberRole } from '../types/auth.js';

export function canCreateBookings(role?: TenantMemberRole | null) {
  return hasPermission(role, 'booking.create');
}

export function canUpdateBookings(role?: TenantMemberRole | null) {
  return hasPermission(role, 'booking.update');
}

export function canCancelBookings(role?: TenantMemberRole | null) {
  return hasPermission(role, 'booking.cancel');
}

export function canViewBookings(role?: TenantMemberRole | null) {
  return hasPermission(role, 'booking.read');
}

export function canAssignBookingAttendees(role?: TenantMemberRole | null) {
  return hasPermission(role, 'booking.assign_attendees');
}