import { createUniqueSlug } from '../../lib/slug.js';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { events } from '../../db/schema/events.js';
import { bookingOrders } from '../../db/schema/booking-orders.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { insertWithSlugRetry } from '../../lib/slug-write.js';
import type { PublicAuthUser, TenantMembershipRecord } from '../../types/auth.js';
import type { TenantMemberRole } from '../../types/auth.js';
import { db } from '../../db/client.js';
import {
  countTenantOwners,
  createTenantMemberRecord,
  createTenantRecord,
  deactivateTenant,
  deleteTenantMemberRecord,
  findTenantBySlug,
  findTenantMemberById,
  findTenantMemberByTenantAndUser,
  findUserById,
  findUserByEmail,
  listTenantMembers,
  listTenantsForUser,
  updateTenantMemberRoleRecord,
  updateTenantRecord
} from './repository.js';
import type {
  CreateTenantInput,
  CreateTenantMemberInput,
  TenantListQueryInput,
  UpdateTenantInput,
  UpdateTenantMemberInput
} from './schema.js';
import type { TenantDetailItem, TenantListItem, TenantMemberListItem } from './types.js';

function assertMembershipRole(actorRole: TenantMemberRole, targetRole: TenantMemberRole) {
  const hierarchy: TenantMemberRole[] = ['viewer', 'staff', 'manager', 'admin', 'owner'];
  const actorIndex = hierarchy.indexOf(actorRole);
  const targetIndex = hierarchy.indexOf(targetRole);

  if (targetIndex >= actorIndex && actorRole !== 'owner') {
    throw forbidden('Cannot assign equal or higher tenant roles');
  }
}

function formatMemberListItem(row: any): TenantMemberListItem {
  return row as TenantMemberListItem;
}

export async function createTenant(
  actor: PublicAuthUser,
  input: CreateTenantInput,
  opts: { approvalStatus?: 'pending' | 'approved' | 'rejected' } = {}
) {
  const tenant = await db.transaction(async (tx) => {
    const createdTenant = await insertWithSlugRetry(
      (slug) =>
        createTenantRecord(tx, {
          ...input,
          slug,
          createdByUserId: actor.id,
          approvalStatus: opts.approvalStatus
        }),
      () => createUniqueSlug(input.slug ?? input.name)
    );

    if (!createdTenant) {
      throw conflict('Unable to create tenant');
    }

    const ownerMembership = await createTenantMemberRecord(tx, {
      tenantId: createdTenant.id,
      userId: actor.id,
      role: 'owner',
      invitedByUserId: actor.id
    });

    if (!ownerMembership) {
      throw conflict('Unable to create tenant owner membership');
    }

    return createdTenant;
  });

  return tenant;
}

export async function listTenants(actor: PublicAuthUser, input: TenantListQueryInput) {
  const pagination = parsePagination(input);
  const { rows, total } = await listTenantsForUser(db, actor.id, input, pagination);

  return {
    items: rows as TenantListItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getTenant(actor: PublicAuthUser, slug: string) {
  let tenant;
  try {
    tenant = await findTenantBySlug(db, slug);
  } catch (err) {
    throw badRequest('Invalid tenant identifier');
  }

  if (!tenant || !tenant.isActive || tenant.deletedAt) {
    throw notFound('Tenant not found');
  }

  const membership = await findTenantMemberByTenantAndUser(db, tenant.id, actor.id);

  if (!membership) {
    throw forbidden('You do not have access to this tenant');
  }

  return {
    tenant,
    membership
  } satisfies TenantDetailItem;
}

export async function updateTenant(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  input: UpdateTenantInput
) {
  if (actorMembership.role !== 'owner' && actorMembership.role !== 'admin') {
    throw forbidden('Insufficient tenant permissions');
  }

  return assertOptimisticUpdate(await updateTenantRecord(db, tenantId, input as UpdateTenantInput & { lastKnownUpdatedAt: string }));
}

export async function deleteTenant(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  lastKnownUpdatedAt: string,
  confirmDelete?: boolean
) {
  if (actorMembership.role !== 'owner') {
    throw forbidden('Only tenant owners can delete tenants');
  }

  if (confirmDelete !== true) {
    throw badRequest('Must confirm tenant deletion');
  }

  // Check for upcoming events
  const upcomingEventsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        eq(events.tenantId, tenantId),
        isNull(events.deletedAt),
        sql`${events.startDateTime} > now()`,
        sql`${events.status} != 'cancelled'`
      )
    );

  if (Number(upcomingEventsCount[0]?.count ?? 0) > 0) {
    throw conflict('Cannot delete tenant with active upcoming events');
  }

  // Check for active bookings
  const activeBookingsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookingOrders)
    .where(
      and(
        eq(bookingOrders.tenantId, tenantId),
        isNull(bookingOrders.deletedAt),
        inArray(bookingOrders.status, ['pending', 'confirmed', 'paid', 'completed'])
      )
    );

  if (Number(activeBookingsCount[0]?.count ?? 0) > 0) {
    throw conflict('Cannot delete tenant with active bookings');
  }

  return assertOptimisticUpdate(await deactivateTenant(db, tenantId, lastKnownUpdatedAt));
}


export async function listMembers(tenantId: string, paginationInput: { page?: number; limit?: number }) {
  const pagination = parsePagination(paginationInput);
  const { rows, total } = await listTenantMembers(db, tenantId, pagination);

  return {
    items: rows.map(formatMemberListItem),
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function addMember(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  input: CreateTenantMemberInput
) {
  assertMembershipRole(actorMembership.role, input.role);
  let targetUser = null;
  try {
    if (input.userId) {
      targetUser = await findUserById(db, input.userId);
    } else if (input.email) {
      targetUser = await findUserByEmail(db, input.email);
    }
  } catch (err) {
    throw badRequest('Invalid user identifier');
  }

  if (!targetUser) {
    throw notFound('User not found');
  }

  const existingMembership = await findTenantMemberByTenantAndUser(db, tenantId, targetUser.id);

  if (existingMembership) {
    throw conflict('User is already a tenant member');
  }

  try {
    const member = await createTenantMemberRecord(db, {
      tenantId,
      userId: targetUser.id,
      role: input.role,
      invitedByUserId: actorMembership.userId
    });

    if (!member) {
      throw conflict('Unable to add tenant member');
    }

    return member;
  } catch (err) {
    // Let the error middleware map database errors, but convert unexpected issues to conflict
    throw conflict('Unable to add tenant member');
  }
}

export async function changeMemberRole(
  tenantId: string,
  memberId: string,
  actorMembership: TenantMembershipRecord,
  input: UpdateTenantMemberInput
) {
  const member = await findTenantMemberById(db, memberId);

  if (!member || member.tenantId !== tenantId) {
    throw notFound('Tenant member not found');
  }

  assertMembershipRole(actorMembership.role, input.role);

  if (member.role === 'owner' && input.role !== 'owner') {
    const owners = await countTenantOwners(db, tenantId);
    if (owners <= 1) {
      throw badRequest('Cannot remove the last tenant owner');
    }
  }

  return assertOptimisticUpdate(await updateTenantMemberRoleRecord(db, memberId, input));
}

export async function removeMember(tenantId: string, memberId: string, actorMembership: TenantMembershipRecord, lastKnownUpdatedAt: string) {
  const member = await findTenantMemberById(db, memberId);

  if (!member || member.tenantId !== tenantId) {
    throw notFound('Tenant member not found');
  }

  if (member.role === 'owner') {
    const owners = await countTenantOwners(db, tenantId);
    if (owners <= 1) {
      throw badRequest('Cannot remove the last tenant owner');
    }
  }

  if (actorMembership.role !== 'owner' && actorMembership.role !== 'admin') {
    throw forbidden('Insufficient tenant permissions');
  }

  return assertOptimisticUpdate(await deleteTenantMemberRecord(db, memberId, lastKnownUpdatedAt));
}
