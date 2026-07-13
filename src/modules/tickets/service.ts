import { db } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { createSlug, createUniqueSlug } from '../../lib/slug.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { insertWithSlugRetry } from '../../lib/slug-write.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import { canManageTickets } from '../../policies/ticket.policy.js';
import inventory from '../inventory/service.js';
import {
  createTicketTypeRecord,
  findEventByTenantAndId,
  findTicketTypeByTenantAndId,
  findTicketTypeByTenantAndSlug,
  listTicketTypesForTenant,
  softDeleteTicketTypeRecord,
  updateTicketTypeRecord
} from './repository.js';
import type {
  CreateTicketTypeDTO,
  TicketTypeDetailItem,
  TicketTypeListItem,
  TicketTypeListQuery,
  UpdateTicketTypeDTO
} from './types.js';

function assertTicketManagementAccess(membership: TenantMembershipRecord) {
  if (!canManageTickets(membership.role)) {
    throw forbidden('Insufficient ticket permissions');
  }
}

function assertTicketReadAccess(membership: TenantMembershipRecord) {
  if (!membership.role) {
    throw forbidden('Insufficient ticket permissions');
  }
}

function normalizeSlugOrThrow(value: string) {
  const normalized = createSlug(value);

  if (!normalized) {
    throw badRequest('Invalid slug value');
  }

  return normalized;
}

async function ensureEventBelongsToTenant(tenantId: string, eventId: string) {
  const event = await findEventByTenantAndId(db, tenantId, eventId);

  if (!event) {
    throw badRequest('Invalid eventId for tenant');
  }

  return event;
}

function resolveSaleDate(saleStartDate?: string | null) {
  if (!saleStartDate) {
    return null;
  }

  return new Date(saleStartDate);
}

function resolveSaleEndDate(saleEndDate?: string | null) {
  if (!saleEndDate) {
    return null;
  }

  return new Date(saleEndDate);
}

function validatePurchaseLimits(minPerOrder: number, maxPerOrder: number) {
  if (minPerOrder > maxPerOrder) {
    throw badRequest('minPerOrder cannot exceed maxPerOrder');
  }
}

function validateSaleWindow(start?: string | null, end?: string | null) {
  if (start && end && !(new Date(end).getTime() > new Date(start).getTime())) {
    throw badRequest('saleEndDate must be after saleStartDate');
  }
}

function normalizeTicketRow(row: Awaited<ReturnType<typeof findTicketTypeByTenantAndSlug>>) {
  if (!row) {
    return null;
  }

  return row as TicketTypeDetailItem;
}

export async function createTicketType(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  input: CreateTicketTypeDTO
) {
  assertTicketManagementAccess(actorMembership);
  await ensureEventBelongsToTenant(tenantId, input.eventId);

  const saleStartDate = resolveSaleDate(input.saleStartDate);
  const saleEndDate = resolveSaleEndDate(input.saleEndDate);

  validatePurchaseLimits(input.minPerOrder, input.maxPerOrder);
  validateSaleWindow(input.saleStartDate, input.saleEndDate);

  return db.transaction(async (tx) => {
    const ticketType = await insertWithSlugRetry(
      (slug) =>
        createTicketTypeRecord(tx, {
          ...input,
          tenantId,
          slug,
          createdByUserId: actorUserId,
          saleStartDate,
          saleEndDate
        }),
      () => createUniqueSlug(input.slug ?? input.name)
    );

    if (!ticketType) {
      throw conflict('Unable to create ticket type');
    }

    const [enriched] = await inventory.withDerivedInventory(tx, tenantId, [ticketType]);

    return enriched as TicketTypeDetailItem;
  });
}

export async function listTicketTypes(tenantId: string, actorMembership: TenantMembershipRecord, input: TicketTypeListQuery) {
  assertTicketReadAccess(actorMembership);

  const pagination = parsePagination(input);
  const { rows, total } = await listTicketTypesForTenant(db, tenantId, input, pagination);
  const enriched = await inventory.withDerivedInventory(db, tenantId, rows);

  return {
    items: enriched as TicketTypeListItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getTicketTypeBySlug(tenantId: string, actorMembership: TenantMembershipRecord, slug: string) {
  assertTicketReadAccess(actorMembership);

  const normalizedSlug = normalizeSlugOrThrow(slug);
  const ticketType = await findTicketTypeByTenantAndSlug(db, tenantId, normalizedSlug);

  if (!ticketType) {
    throw notFound('Ticket type not found');
  }

  const [enriched] = await inventory.withDerivedInventory(db, tenantId, [ticketType]);
  return enriched as TicketTypeDetailItem;
}

export async function updateTicketTypeBySlug(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string,
  input: UpdateTicketTypeDTO
) {
  assertTicketManagementAccess(actorMembership);

  const normalizedSlug = normalizeSlugOrThrow(slug);
  const existing = await findTicketTypeByTenantAndSlug(db, tenantId, normalizedSlug);

  if (!existing) {
    throw notFound('Ticket type not found');
  }

  const nextEventId = input.eventId ?? existing.eventId;
  await ensureEventBelongsToTenant(tenantId, nextEventId);

  const nextTotalQuantity = input.totalQuantity ?? existing.totalQuantity;
  const nextSoldQuantity = input.soldQuantity ?? existing.soldQuantity;
  const nextReservedQuantity = input.reservedQuantity ?? existing.reservedQuantity;
  const nextMinPerOrder = input.minPerOrder ?? existing.minPerOrder;
  const nextMaxPerOrder = input.maxPerOrder ?? existing.maxPerOrder;
  const nextSaleStartDate = input.saleStartDate === undefined ? existing.saleStartDate : input.saleStartDate ? new Date(input.saleStartDate) : null;
  const nextSaleEndDate = input.saleEndDate === undefined ? existing.saleEndDate : input.saleEndDate ? new Date(input.saleEndDate) : null;
  const nextSlug = input.slug === undefined ? normalizedSlug : normalizeSlugOrThrow(input.slug);

  if (nextSlug !== normalizedSlug) {
    const slugExists = await findTicketTypeByTenantAndSlug(db, tenantId, nextSlug);

    if (slugExists) {
      throw conflict('Ticket slug already exists for tenant');
    }
  }

  validatePurchaseLimits(nextMinPerOrder, nextMaxPerOrder);
  validateSaleWindow(nextSaleStartDate ? nextSaleStartDate.toISOString() : null, nextSaleEndDate ? nextSaleEndDate.toISOString() : null);

  const updated = await updateTicketTypeRecord(db, tenantId, normalizedSlug, {
    ...input,
    slug: input.slug === undefined ? undefined : nextSlug,
    updatedByUserId: actorUserId,
    saleStartDate: nextSaleStartDate,
    saleEndDate: nextSaleEndDate,
    lastKnownUpdatedAt: input.lastKnownUpdatedAt
  });

  const [enriched] = await inventory.withDerivedInventory(db, tenantId, [assertOptimisticUpdate(updated)]);
  return enriched as TicketTypeDetailItem;
}

export async function deleteTicketTypeBySlug(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  slug: string,
  lastKnownUpdatedAt: string
) {
  assertTicketManagementAccess(actorMembership);

  const normalizedSlug = normalizeSlugOrThrow(slug);
  const updated = assertOptimisticUpdate(await softDeleteTicketTypeRecord(db, tenantId, normalizedSlug, actorUserId, lastKnownUpdatedAt));
  // After soft deletion, the ticket type is marked as deleted. No inventory summary needed.
  return updated as TicketTypeDetailItem;
}
