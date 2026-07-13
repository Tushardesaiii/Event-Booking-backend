import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { emailCampaignStatusEnum } from './enums.js';
import { softDeleteColumn, timestampColumns } from './helpers.js';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { emailSegments } from './email-segments.js';
import { emailTemplates } from './email-templates.js';

export const emailCampaigns = pgTable(
  'email_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {
      onDelete: 'restrict'
    }),
    templateId: uuid('template_id').references(() => emailTemplates.id, {
      onDelete: 'set null'
    }),
    segmentId: uuid('segment_id').references(() => emailSegments.id, {
      onDelete: 'set null'
    }),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    status: emailCampaignStatusEnum('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', {
      withTimezone: true,
      mode: 'date'
    }),
    sentAt: timestamp('sent_at', {
      withTimezone: true,
      mode: 'date'
    }),
    startedAt: timestamp('started_at', {
      withTimezone: true,
      mode: 'date'
    }),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'date'
    }),
    cancelledAt: timestamp('cancelled_at', {
      withTimezone: true,
      mode: 'date'
    }),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict'
    }),
    audienceFiltersJson: jsonb('audience_filters_json').notNull().default(sql`'{}'::jsonb`),
    ...timestampColumns,
    deletedAt: softDeleteColumn
  },
  (table) => ({
    tenantIdx: index('email_campaigns_tenant_id_idx').on(table.tenantId),
    tenantStatusIdx: index('email_campaigns_tenant_id_status_idx').on(table.tenantId, table.status),
    scheduledAtIdx: index('email_campaigns_scheduled_at_idx').on(table.scheduledAt),
    createdAtIdx: index('email_campaigns_created_at_idx').on(table.createdAt),
    templateIdx: index('email_campaigns_template_id_idx').on(table.templateId),
    segmentIdx: index('email_campaigns_segment_id_idx').on(table.segmentId),
    tenantNameUnique: uniqueIndex('email_campaigns_tenant_id_name_unique').on(table.tenantId, table.name)
  })
);
