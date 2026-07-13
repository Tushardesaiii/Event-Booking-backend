import type { InferSelectModel } from 'drizzle-orm';

import type { PublicAuthUser, TenantMembershipRecord, TenantRecord } from '../../types/auth.js';

export type Tenant = TenantRecord;
export type TenantMember = TenantMembershipRecord;

export interface TenantListItem {
  tenant: Tenant;
  role: TenantMember['role'];
}

export interface TenantMemberListItem {
  member: TenantMember;
  user: PublicAuthUser;
}

export interface TenantDetailItem {
  tenant: Tenant;
  membership: TenantMember;
}

export interface TenantWithCreator extends Tenant {
  creator?: PublicAuthUser | null;
}export type {};