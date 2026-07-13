import type { TenantMemberRole } from '../types/auth.js';
import { hasPermission } from '../lib/permissions.js';

export function canManageEvents(role?: TenantMemberRole | null) {
  return hasPermission(role, 'event.manage');
}

export function canViewEvents(role?: TenantMemberRole | null) {
  return role !== null && role !== undefined;
}
