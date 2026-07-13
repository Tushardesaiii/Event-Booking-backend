import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

export const timestampColumns = {
  createdAt: timestamp('created_at', {
    withTimezone: true,
    mode: 'date'
  })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
    mode: 'date'
  })
    .notNull()
    .defaultNow()
};

export const softDeleteColumn = timestamp('deleted_at', {
  withTimezone: true,
  mode: 'date'
});

export const activeRecordWhere = sql`deleted_at is null`;
