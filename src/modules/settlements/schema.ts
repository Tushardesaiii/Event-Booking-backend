import { bigint, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { softDeleteColumn, timestampColumns } from '../../db/schema/helpers.js';
import { tenants } from '../../db/schema/tenants.js';
import { events } from '../../db/schema/events.js';

// Manual cheque payouts to organizers. Revelis collects all ticket payments and
// settles net proceeds by cheque: an "advance" before the event and the "final"
// balance after it ends. All money columns are in PAISE.
export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'advance' | 'final'
    grossSales: bigint('gross_sales', { mode: 'number' }).notNull().default(0),
    platformFee: bigint('platform_fee', { mode: 'number' }).notNull().default(0),
    refunds: bigint('refunds', { mode: 'number' }).notNull().default(0),
    netPayable: bigint('net_payable', { mode: 'number' }).notNull().default(0),
    chequeNo: text('cheque_no'),
    scheduledDate: text('scheduled_date'), // 'YYYY-MM-DD'
    status: text('status').notNull().default('pending'), // pending | cheque-issued | cleared | on-hold
    notes: text('notes'),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('settlements_tenant_id_idx').on(table.tenantId),
    eventIdx: index('settlements_event_id_idx').on(table.eventId),
    statusIdx: index('settlements_status_idx').on(table.status)
  })
);
