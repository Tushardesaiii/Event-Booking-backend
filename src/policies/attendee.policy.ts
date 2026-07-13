import { hasPermission, hasRole } from '../lib/permissions.js';
import type { TenantMemberRole } from '../types/auth.js';

export function canViewAttendees(role?: TenantMemberRole | null) {
  return hasRole(role, 'staff');
}

export function canManageAttendees(role?: TenantMemberRole | null) {
  return hasPermission(role, 'attendee.manage');
}