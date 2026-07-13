import { sql } from 'drizzle-orm';
import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from './helpers.js';
import { events } from './events.js';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { ticketStatusEnum, ticketTaxBehaviorEnum, ticketVisibilityEnum } from './enums.js';

export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    price: numeric('price', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('INR'),
    taxBehavior: ticketTaxBehaviorEnum('tax_behavior').notNull().default('exclusive'),
    totalQuantity: integer('total_quantity').notNull().default(0),
    soldQuantity: integer('sold_quantity').notNull().default(0),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    minPerOrder: integer('min_per_order').notNull().default(1),
    maxPerOrder: integer('max_per_order').notNull().default(10),
    saleStartDate: timestamp('sale_start_date', { withTimezone: true, mode: 'date' }),
    saleEndDate: timestamp('sale_end_date', { withTimezone: true, mode: 'date' }),
    visibility: ticketVisibilityEnum('visibility').notNull().default('public'),
    status: ticketStatusEnum('status').notNull().default('draft'),
    isTransferable: boolean('is_transferable').notNull().default(false),
    isRefundable: boolean('is_refundable').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('ticket_types_tenant_id_idx').on(table.tenantId),
    eventIdx: index('ticket_types_event_id_idx').on(table.eventId),
    slugIdx: index('ticket_types_slug_idx').on(table.slug),
    statusIdx: index('ticket_types_status_idx').on(table.status),
    tenantEventStatusIdx: index('ticket_types_tenant_event_status_idx').on(table.tenantId, table.eventId, table.status).where(sql`${table.deletedAt} is null`),
    visibilityIdx: index('ticket_types_visibility_idx').on(table.visibility),
    saleStartDateIdx: index('ticket_types_sale_start_date_idx').on(table.saleStartDate),
    saleEndDateIdx: index('ticket_types_sale_end_date_idx').on(table.saleEndDate),
    priceIdx: index('ticket_types_price_idx').on(table.price),
    createdAtIdx: index('ticket_types_created_at_idx').on(table.createdAt),
    slugUnique: uniqueIndex('ticket_types_slug_unique').on(table.slug)
  })
);
