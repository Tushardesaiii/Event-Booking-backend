import { TENANT_ROLES } from '../constants/roles.js';
import type { TenantMemberRole } from '../types/auth.js';

export const TENANT_ROLE_HIERARCHY = TENANT_ROLES;

export const TENANT_PERMISSIONS = [
  'tenant.manage',
  'tenant.delete',
  'tenant.transfer_ownership',
  'member.manage',
  'event.create',
  'event.publish',
  'event.manage',
  'ticket.manage',
  'ticket.issue',
  'ticket.read',
  'ticket.invalidate',
  'ticket.cancel',
  'ticket.transfer',
  'ticket.checkin',
  'attendee.manage',
  'booking.create',
  'booking.update',
  'booking.cancel',
  'booking.read',
  'booking.assign_attendees',
  'venue.manage',
  'analytics.view',
  'campaign.manage',
  'payout.manage',
  'billing.manage',
  'email.view',
  'email.subscriber.manage',
  'email.template.manage',
  'email.campaign.create',
  'email.campaign.manage'
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

const roleRank: Record<TenantMemberRole, number> = {
  viewer: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4
};

const viewerPermissions = [
  'analytics.view',
  'email.view'
] as const;

const staffPermissions = [
  ...viewerPermissions,
  'booking.read',
  'email.subscriber.manage',
  'ticket.read',
  'ticket.checkin'
] as const;

const managerPermissions = [
  ...staffPermissions,
  'attendee.manage',
  'booking.assign_attendees',
  'booking.cancel',
  'booking.create',
  'booking.update',
  'campaign.manage',
  'event.create',
  'event.publish',
  'event.manage',
  'ticket.cancel',
  'ticket.invalidate',
  'ticket.issue',
  'ticket.transfer',
  'ticket.manage',
  'venue.manage',
  'email.template.manage',
  'email.campaign.create'
] as const;

const adminPermissions = [
  ...managerPermissions,
  'member.manage',
  'tenant.manage',
  'email.campaign.manage'
] as const;

const ownerPermissions = TENANT_PERMISSIONS;

const rolePermissions: Record<TenantMemberRole, readonly TenantPermission[]> = {
  viewer: viewerPermissions,
  staff: staffPermissions,
  manager: managerPermissions,
  admin: adminPermissions,
  owner: ownerPermissions
};

export function hasRole(
  role: TenantMemberRole | null | undefined,
  requiredRole: TenantMemberRole | readonly TenantMemberRole[]
) {
  if (!role) {
    return false;
  }

  const requiredRoles: readonly TenantMemberRole[] = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

  return requiredRoles.some((candidate) => roleRank[role] >= roleRank[candidate]);
}

export function hasPermission(role: TenantMemberRole | null | undefined, permission: TenantPermission) {
  if (!role) {
    return false;
  }

  return rolePermissions[role].includes(permission);
}

export function isTenantOwner(roleOrMembership?: TenantMemberRole | { role?: TenantMemberRole | null } | null) {
  if (!roleOrMembership) {
    return false;
  }

  const role = typeof roleOrMembership === 'string' ? roleOrMembership : roleOrMembership.role ?? null;
  return role === 'owner';
}
