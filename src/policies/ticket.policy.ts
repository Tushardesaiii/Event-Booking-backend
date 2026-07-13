import type { TenantMemberRole } from '../types/auth.js';
import { hasPermission } from '../lib/permissions.js';

export function canManageTickets(role?: TenantMemberRole | null) {
  return hasPermission(role, 'ticket.manage');
}
