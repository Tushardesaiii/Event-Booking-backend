import type { TenantMemberRole } from '../types/auth.js';

export const TENANT_ROLES = [
  'owner',
  'admin',
  'manager',
  'staff',
  'viewer'
] as const satisfies readonly TenantMemberRole[];

export type TenantRole = (typeof TENANT_ROLES)[number];