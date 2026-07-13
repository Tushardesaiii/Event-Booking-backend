import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { verificationEvents } from '../../db/schema/verification-events.js';
import { notifications, notificationPreferences } from './schema.js';
import { logger } from '../../lib/logger.js';
import type {
  CreateInAppNotificationDTO,
  InAppNotificationRecord,
  NotificationPreferenceRecord,
  UpdateNotificationPreferencesDTO
} from './types.js';

export interface CreateVerificationEventInput {
  actorUserId?: string | null;
  tenantId?: string | null;
  eventType: string;
  source: string; // 'email' | 'otp' | 'marketing'
  email?: string | null;
  phoneNumber?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  providerResponse?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, any> | null;
}

type DBInstance = typeof db | any;

export async function insertVerificationEvent(
  database: DBInstance,
  input: CreateVerificationEventInput
) {
  try {
    const [event] = await database
      .insert(verificationEvents)
      .values({
        actorUserId: input.actorUserId ?? null,
        tenantId: input.tenantId ?? null,
        eventType: input.eventType,
        source: input.source,
        email: input.email ?? null,
        phoneNumber: input.phoneNumber ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        provider: input.provider ?? null,
        providerMessageId: input.providerMessageId ?? null,
        providerStatus: input.providerStatus ?? null,
        providerResponse: input.providerResponse ?? null,
        correlationId: input.correlationId ?? null,
        requestId: input.requestId ?? null,
        metadata: input.metadata ?? {}
      })
      .returning();

    return event ?? null;
  } catch (error) {
    logger.error('Failed to insert verification event record', { error, input });
    return null;
  }
}

export async function insertInAppNotificationRecord(
  database: DBInstance,
  input: CreateInAppNotificationDTO
) {
  const [notification] = await database
    .insert(notifications)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title,
      message: input.message,
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {}
    })
    .returning();

  return notification ?? null;
}

export async function markNotificationAsReadRecord(
  database: DBInstance,
  tenantId: string,
  userId: string,
  id: string
) {
  const [notification] = await database
    .update(notifications)
    .set({
      readAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
        eq(notifications.id, id),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt)
      )
    )
    .returning();

  return notification ?? null;
}

export async function markAllNotificationsAsReadRecord(
  database: DBInstance,
  tenantId: string,
  userId: string
) {
  return database
    .update(notifications)
    .set({
      readAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt)
      )
    )
    .returning();
}

export async function listInAppNotificationsRecord(
  database: DBInstance,
  tenantId: string,
  userId: string,
  isReadFilter: boolean | undefined,
  pagination: { offset: number; limit: number }
) {
  const conditions = [
    eq(notifications.tenantId, tenantId),
    eq(notifications.userId, userId),
    isNull(notifications.deletedAt)
  ];

  if (isReadFilter === true) {
    conditions.push(sql`read_at is not null`);
  } else if (isReadFilter === false) {
    conditions.push(isNull(notifications.readAt));
  }

  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(notifications)
    .where(whereClause);

  const rows = await database
    .select()
    .from(notifications)
    .where(whereClause)
    .orderBy(desc(notifications.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows: rows as InAppNotificationRecord[],
    total: Number(totalRow?.total ?? 0)
  };
}

export async function findNotificationPreferenceRecord(
  database: DBInstance,
  tenantId: string,
  userId: string
) {
  const [pref] = await database
    .select()
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.tenantId, tenantId), eq(notificationPreferences.userId, userId)))
    .limit(1);

  return pref ?? null;
}

export async function upsertNotificationPreferenceRecord(
  database: DBInstance,
  tenantId: string,
  userId: string,
  input: UpdateNotificationPreferencesDTO
) {
  const existing = await findNotificationPreferenceRecord(database, tenantId, userId);

  if (existing) {
    const [updated] = await database
      .update(notificationPreferences)
      .set({
        ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
        ...(input.smsEnabled === undefined ? {} : { smsEnabled: input.smsEnabled }),
        ...(input.inAppEnabled === undefined ? {} : { inAppEnabled: input.inAppEnabled }),
        ...(input.preferences === undefined ? {} : { preferences: input.preferences }),
        updatedAt: new Date()
      })
      .where(eq(notificationPreferences.id, existing.id))
      .returning();

    return updated ?? null;
  }

  const [created] = await database
    .insert(notificationPreferences)
    .values({
      tenantId,
      userId,
      emailEnabled: input.emailEnabled ?? true,
      smsEnabled: input.smsEnabled ?? true,
      inAppEnabled: input.inAppEnabled ?? true,
      preferences: input.preferences ?? {}
    })
    .returning();

  return created ?? null;
}
