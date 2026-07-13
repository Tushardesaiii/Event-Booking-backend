import type { TenantMemberRole } from '../types/auth.js';
import { hasPermission } from '../lib/permissions.js';

export function canManageTenant(role?: TenantMemberRole | null) {
  return hasPermission(role, 'tenant.manage');
}
