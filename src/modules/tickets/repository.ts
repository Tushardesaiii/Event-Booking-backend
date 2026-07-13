import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { events } from '../../db/schema/events.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import { optimisticLockCondition } from '../../lib/optimistic-locking.js';
import type {
  CreateTicketTypeDTO,
  TicketTypeListQuery,
  TicketTypeRecord,
  UpdateTicketTypeDTO
} from './types.js';

type TicketDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

const ticketTypeSelect = {
  id: ticketTypes.id,
  tenantId: ticketTypes.tenantId,
  eventId: ticketTypes.eventId,
  name: ticketTypes.name,
  slug: ticketTypes.slug,
  description: ticketTypes.description,
  price: ticketTypes.price,
  currency: ticketTypes.currency,
  taxBehavior: ticketTypes.taxBehavior,
  totalQuantity: ticketTypes.totalQuantity,
  soldQuantity: ticketTypes.soldQuantity,
  reservedQuantity: ticketTypes.reservedQuantity,
  minPerOrder: ticketTypes.minPerOrder,
  maxPerOrder: ticketTypes.maxPerOrder,
  saleStartDate: ticketTypes.saleStartDate,
  saleEndDate: ticketTypes.saleEndDate,
  visibility: ticketTypes.visibility,
  status: ticketTypes.status,
  isTransferable: ticketTypes.isTransferable,
  isRefundable: ticketTypes.isRefundable,
  createdByUserId: ticketTypes.createdByUserId,
  updatedByUserId: ticketTypes.updatedByUserId,
  createdAt: ticketTypes.createdAt,
  updatedAt: ticketTypes.updatedAt,
  deletedAt: ticketTypes.deletedAt,
  eventTitle: events.title
} as const;

const ticketCoreSelect = {
  id: ticketTypes.id,
  tenantId: ticketTypes.tenantId,
  eventId: ticketTypes.eventId,
  name: ticketTypes.name,
  slug: ticketTypes.slug,
  description: ticketTypes.description,
  price: ticketTypes.price,
  currency: ticketTypes.currency,
  taxBehavior: ticketTypes.taxBehavior,
  totalQuantity: ticketTypes.totalQuantity,
  soldQuantity: ticketTypes.soldQuantity,
  reservedQuantity: ticketTypes.reservedQuantity,
  minPerOrder: ticketTypes.minPerOrder,
  maxPerOrder: ticketTypes.maxPerOrder,
  saleStartDate: ticketTypes.saleStartDate,
  saleEndDate: ticketTypes.saleEndDate,
  visibility: ticketTypes.visibility,
  status: ticketTypes.status,
  isTransferable: ticketTypes.isTransferable,
  isRefundable: ticketTypes.isRefundable,
  createdByUserId: ticketTypes.createdByUserId,
  updatedByUserId: ticketTypes.updatedByUserId,
  createdAt: ticketTypes.createdAt,
  updatedAt: ticketTypes.updatedAt,
  deletedAt: ticketTypes.deletedAt
} as const;

function buildWhereClause(tenantId: string, input: TicketTypeListQuery) {
  const conditions = [eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)];

  if (input.eventId) {
    conditions.push(eq(ticketTypes.eventId, input.eventId));
  }

  if (input.status) {
    conditions.push(eq(ticketTypes.status, input.status));
  }

  if (input.visibility) {
    conditions.push(eq(ticketTypes.visibility, input.visibility));
  }

  if (input.isRefundable !== undefined) {
    conditions.push(eq(ticketTypes.isRefundable, input.isRefundable));
  }

  if (input.isTransferable !== undefined) {
    conditions.push(eq(ticketTypes.isTransferable, input.isTransferable));
  }

  if (input.search) {
    const search = `%${input.search}%`;
    conditions.push(
      or(
        ilike(ticketTypes.name, search),
        ilike(ticketTypes.slug, search),
        ilike(ticketTypes.description, search),
        ilike(events.title, search)
      )!
    );
  }

  return and(...conditions);
}

function resolveOrderBy(input: Pick<TicketTypeListQuery, 'sortBy' | 'sortOrder'>) {
  const direction = input.sortOrder === 'asc' ? asc : desc;

  switch (input.sortBy) {
    case 'price':
      return [direction(ticketTypes.price), asc(ticketTypes.slug)];
    case 'saleStartDate':
      return [direction(ticketTypes.saleStartDate), asc(ticketTypes.slug)];
    case 'createdAt':
    default:
      return [direction(ticketTypes.createdAt), asc(ticketTypes.slug)];
  }
}

export async function findTicketTypeByTenantAndSlug(database: TicketDatabase, tenantId: string, slug: string) {
  const [ticketType] = await database
    .select(ticketSelectForReads())
    .from(ticketTypes)
    .leftJoin(events, and(eq(events.id, ticketTypes.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .where(and(eq(ticketTypes.tenantId, tenantId), eq(ticketTypes.slug, slug), isNull(ticketTypes.deletedAt)))
    .limit(1);

  return ticketType ?? null;
}

function ticketSelectForReads() {
  return ticketTypeSelect;
}

export async function findTicketTypeByTenantAndId(database: TicketDatabase, tenantId: string, id: string) {
  const [ticketType] = await database
    .select(ticketSelectForReads())
    .from(ticketTypes)
    .leftJoin(events, and(eq(events.id, ticketTypes.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .where(and(eq(ticketTypes.tenantId, tenantId), eq(ticketTypes.id, id), isNull(ticketTypes.deletedAt)))
    .limit(1);

  return ticketType ?? null;
}

export async function findEventByTenantAndId(database: TicketDatabase, tenantId: string, eventId: string) {
  const [event] = await database
    .select({ id: events.id, title: events.title, tenantId: events.tenantId })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .limit(1);

  return event ?? null;
}

export async function createTicketTypeRecord(
  database: TicketDatabase,
  input: Omit<CreateTicketTypeDTO, 'saleStartDate' | 'saleEndDate'> & {
    tenantId: string;
    slug: string;
    createdByUserId: string;
    saleStartDate: Date | null;
    saleEndDate: Date | null;
  }
) {
  const [ticketType] = await database
    .insert(ticketTypes)
    .values({
      tenantId: input.tenantId,
      eventId: input.eventId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      price: String(input.price),
      currency: input.currency,
      taxBehavior: input.taxBehavior,
      totalQuantity: input.totalQuantity,
      soldQuantity: input.soldQuantity,
      reservedQuantity: input.reservedQuantity,
      minPerOrder: input.minPerOrder,
      maxPerOrder: input.maxPerOrder,
      saleStartDate: input.saleStartDate,
      saleEndDate: input.saleEndDate,
      visibility: input.visibility,
      status: input.status,
      isTransferable: input.isTransferable,
      isRefundable: input.isRefundable,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.createdByUserId
    })
    .returning(ticketCoreSelect);

  return ticketType ?? null;
}

export async function updateTicketTypeRecord(
  database: TicketDatabase,
  tenantId: string,
  slug: string,
  input: Omit<UpdateTicketTypeDTO, 'saleStartDate' | 'saleEndDate'> & {
    updatedByUserId: string;
    saleStartDate: Date | null | undefined;
    saleEndDate: Date | null | undefined;
  }
) {
  const [ticketType] = await database
    .update(ticketTypes)
    .set({
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.price === undefined ? {} : { price: String(input.price) }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.taxBehavior === undefined ? {} : { taxBehavior: input.taxBehavior }),
      ...(input.totalQuantity === undefined ? {} : { totalQuantity: input.totalQuantity }),
      ...(input.soldQuantity === undefined ? {} : { soldQuantity: input.soldQuantity }),
      ...(input.reservedQuantity === undefined ? {} : { reservedQuantity: input.reservedQuantity }),
      ...(input.minPerOrder === undefined ? {} : { minPerOrder: input.minPerOrder }),
      ...(input.maxPerOrder === undefined ? {} : { maxPerOrder: input.maxPerOrder }),
      ...(input.saleStartDate === undefined ? {} : { saleStartDate: input.saleStartDate }),
      ...(input.saleEndDate === undefined ? {} : { saleEndDate: input.saleEndDate }),
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.isTransferable === undefined ? {} : { isTransferable: input.isTransferable }),
      ...(input.isRefundable === undefined ? {} : { isRefundable: input.isRefundable }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date()
    })
    .where(and(eq(ticketTypes.tenantId, tenantId), eq(ticketTypes.slug, slug), optimisticLockCondition(ticketTypes.updatedAt, input.lastKnownUpdatedAt), isNull(ticketTypes.deletedAt)))
    .returning(ticketCoreSelect);

  return ticketType ?? null;
}

export async function softDeleteTicketTypeRecord(
	database: TicketDatabase,
	tenantId: string,
	slug: string,
	updatedByUserId: string,
	lastKnownUpdatedAt: string
) {
  const [ticketType] = await database
    .update(ticketTypes)
    .set({
      updatedByUserId,
      updatedAt: new Date(),
      deletedAt: new Date()
    })
    .where(and(eq(ticketTypes.tenantId, tenantId), eq(ticketTypes.slug, slug), optimisticLockCondition(ticketTypes.updatedAt, lastKnownUpdatedAt), isNull(ticketTypes.deletedAt)))
    .returning(ticketCoreSelect);

  return ticketType ?? null;
}

export async function listTicketTypesForTenant(
  database: TicketDatabase,
  tenantId: string,
  input: TicketTypeListQuery,
  pagination: { offset: number; limit: number }
) {
  const whereClause = buildWhereClause(tenantId, input);
  const orderBy = resolveOrderBy(input);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(ticketTypes)
    .leftJoin(events, and(eq(events.id, ticketTypes.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .where(whereClause);

  const rows = await database
    .select(ticketSelectForReads())
    .from(ticketTypes)
    .leftJoin(events, and(eq(events.id, ticketTypes.eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as Array<TicketTypeRecord & { availableQuantity: number; eventTitle: string | null }>,
    total: Number(totalRow?.total ?? 0)
  };
}
