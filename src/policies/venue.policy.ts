import type { TenantMemberRole } from '../types/auth.js';
import { hasPermission } from '../lib/permissions.js';

export function canViewVenues(role?: TenantMemberRole | null) {
  return role !== null && role !== undefined;
}

export function canManageVenues(role?: TenantMemberRole | null) {
  return hasPermission(role, 'venue.manage');
}
