import { sql, type AnyColumn } from 'drizzle-orm';
import { z } from 'zod';

import { staleRequest } from './errors.js';

export const lastKnownUpdatedAtSchema = z.string().datetime({ offset: true });

export const optimisticLockSchema = z.object({
  lastKnownUpdatedAt: lastKnownUpdatedAtSchema
});

export type OptimisticLockInput = z.infer<typeof optimisticLockSchema>;

export function toOptimisticLockTimestamp(lastKnownUpdatedAt: string) {
  return new Date(lastKnownUpdatedAt);
}

export function optimisticLockCondition(column: AnyColumn, lastKnownUpdatedAt: string) {
  return sql<boolean>`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${toOptimisticLockTimestamp(lastKnownUpdatedAt).toISOString()}::timestamptz)`;
}

export function assertOptimisticUpdate<T>(row: T | null | undefined) {
  if (!row) {
    throw staleRequest();
  }

  return row;
}