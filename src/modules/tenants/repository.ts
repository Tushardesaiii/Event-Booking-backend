import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { authAccounts } from '../../db/schema/auth-accounts.js';
import { tenantMembers } from '../../db/schema/tenant-members.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type { TenantMemberRole } from '../../types/auth.js';
import type {
  CreateTenantInput,
  CreateTenantMemberInput,
  TenantListQueryInput,
  UpdateTenantInput,
  UpdateTenantMemberInput
} from './schema.js';

type TenantDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'transaction'>;

const userSelect = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
  phoneNumber: users.phoneNumber,
  phoneVerifiedAt: users.phoneVerifiedAt,
  avatarAssetId: users.avatarAssetId,
  bio: users.bio,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt
} as const;

const tenantSelect = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  description: tenants.description,
  logoAssetId: tenants.logoAssetId,
  coverAssetId: tenants.coverAssetId,
  website: tenants.website,
  email: tenants.email,
  phone: tenants.phone,
  city: tenants.city,
  state: tenants.state,
  country: tenants.country,
  isVerified: tenants.isVerified,
  isActive: tenants.isActive,
  approvalStatus: tenants.approvalStatus,
  rejectionReason: tenants.rejectionReason,
  createdByUserId: tenants.createdByUserId,
  createdAt: tenants.createdAt,
  updatedAt: tenants.updatedAt,
  deletedAt: tenants.deletedAt
} as const;

const tenantMemberSelect = {
  id: tenantMembers.id,
  tenantId: tenantMembers.tenantId,
  userId: tenantMembers.userId,
  role: tenantMembers.role,
  invitedByUserId: tenantMembers.invitedByUserId,
  joinedAt: tenantMembers.joinedAt,
  createdAt: tenantMembers.createdAt,
  updatedAt: tenantMembers.updatedAt
} as const;

export async function findTenantBySlug(database: TenantDatabase, slug: string) {
  const [tenant] = await database.select(tenantSelect).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return tenant ?? null;
}

export async function findTenantById(database: TenantDatabase, tenantId: string) {
  const [tenant] = await database.select(tenantSelect).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant ?? null;
}

export async function findUserById(database: TenantDatabase, userId: string) {
  const [user] = await database
    .select(userSelect)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function createTenantRecord(
  database: TenantDatabase,
  input: CreateTenantInput & {
    createdByUserId: string;
    approvalStatus?: 'pending' | 'approved' | 'rejected';
  }
) {
  const [tenant] = await database
    .insert(tenants)
    .values({
      name: input.name,
      slug: input.slug ?? '',
      description: input.description ?? null,
      logoAssetId: input.logoAssetId ?? null,
      coverAssetId: input.coverAssetId ?? null,
      website: input.website ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      createdByUserId: input.createdByUserId,
      isVerified: false,
      isActive: true,
      // Omitted → DB default 'pending' (new organizer registrations enter the
      // review queue). Seed/admin flows pass 'approved' explicitly.
      ...(input.approvalStatus ? { approvalStatus: input.approvalStatus } : {})
    })
    .returning(tenantSelect);

  return tenant ?? null;
}

export async function updateTenantRecord(
  database: TenantDatabase,
  tenantId: string,
  input: UpdateTenantInput & { lastKnownUpdatedAt: string }
) {
  const [tenant] = await database
    .update(tenants)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.description === undefined ? {} : { description: input.description ?? null }),
      ...(input.logoAssetId === undefined ? {} : { logoAssetId: input.logoAssetId ?? null }),
      ...(input.coverAssetId === undefined ? {} : { coverAssetId: input.coverAssetId ?? null }),
      ...(input.website === undefined ? {} : { website: input.website ?? null }),
      ...(input.email === undefined ? {} : { email: input.email ?? null }),
      ...(input.phone === undefined ? {} : { phone: input.phone ?? null }),
      ...(input.city === undefined ? {} : { city: input.city ?? null }),
      ...(input.state === undefined ? {} : { state: input.state ?? null }),
      ...(input.country === undefined ? {} : { country: input.country ?? null }),
      updatedAt: new Date()
    })
    .where(and(eq(tenants.id, tenantId), optimisticLockCondition(tenants.updatedAt, input.lastKnownUpdatedAt), isNull(tenants.deletedAt)))
    .returning(tenantSelect);

  return tenant ?? null;
}

export async function deactivateTenant(database: TenantDatabase, tenantId: string, lastKnownUpdatedAt: string) {
  const [tenant] = await database
    .update(tenants)
    .set({
      isActive: false,
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(eq(tenants.id, tenantId), optimisticLockCondition(tenants.updatedAt, lastKnownUpdatedAt), isNull(tenants.deletedAt)))
    .returning(tenantSelect);

  return tenant ?? null;
}

export async function countTenantOwners(database: TenantDatabase, tenantId: string) {
  const [row] = await database
    .select({ total: sql<number>`count(*)` })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, 'owner')));

  return Number(row?.total ?? 0);
}

export async function listTenantsForUser(
  database: TenantDatabase,
  userId: string,
  input: TenantListQueryInput,
  pagination: { offset: number; limit: number }
) {
  const conditions = [
    eq(tenantMembers.userId, userId),
    eq(tenants.isActive, input.isActive ?? true)
  ];

  if (input.search) {
    const search = `%${input.search}%`;
    conditions.push(or(ilike(tenants.name, search), ilike(tenants.slug, search))!);
  }

  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(whereClause);

  const rows = await database
    .select({
      tenant: tenantSelect,
      role: tenantMembers.role
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(whereClause)
    .orderBy(desc(tenants.createdAt), asc(tenants.name))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function listTenantMembers(
  database: TenantDatabase,
  tenantId: string,
  pagination: { offset: number; limit: number }
) {
  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));

  const rows = await database
    .select({
      member: tenantMemberSelect,
      user: userSelect
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(eq(tenantMembers.tenantId, tenantId))
    .orderBy(desc(tenantMembers.createdAt), asc(users.fullName))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.total ?? 0)
  };
}

export async function findTenantMemberById(database: TenantDatabase, memberId: string) {
  const [member] = await database.select(tenantMemberSelect).from(tenantMembers).where(eq(tenantMembers.id, memberId)).limit(1);
  return member ?? null;
}

export async function findTenantMemberByTenantAndUser(
  database: TenantDatabase,
  tenantId: string,
  userId: string
) {
  const [member] = await database
    .select(tenantMemberSelect)
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);

  return member ?? null;
}

export async function createTenantMemberRecord(
  database: TenantDatabase,
  input: CreateTenantMemberInput & { tenantId: string; userId: string; invitedByUserId: string | null }
) {
  const [member] = await database
    .insert(tenantMembers)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      invitedByUserId: input.invitedByUserId,
      joinedAt: new Date()
    })
    .returning(tenantMemberSelect);

  return member ?? null;
}

export async function updateTenantMemberRoleRecord(
  database: TenantDatabase,
  memberId: string,
  input: UpdateTenantMemberInput
) {
  const [member] = await database
    .update(tenantMembers)
    .set({ role: input.role, updatedAt: new Date() })
    .where(and(eq(tenantMembers.id, memberId), optimisticLockCondition(tenantMembers.updatedAt, input.lastKnownUpdatedAt)))
    .returning(tenantMemberSelect);

  return member ?? null;
}

export async function deleteTenantMemberRecord(database: TenantDatabase, memberId: string, lastKnownUpdatedAt: string) {
  const [member] = await database
    .delete(tenantMembers)
    .where(and(eq(tenantMembers.id, memberId), optimisticLockCondition(tenantMembers.updatedAt, lastKnownUpdatedAt)))
    .returning(tenantMemberSelect);
  return member ?? null;
}

export async function findUserByEmail(database: TenantDatabase, email: string) {
  const [row] = await database
    .select({ user: userSelect })
    .from(authAccounts)
    .innerJoin(users, eq(authAccounts.userId, users.id))
    .where(eq(authAccounts.email, email))
    .limit(1);

  return row?.user ?? null;
}