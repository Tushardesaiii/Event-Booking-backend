import { env } from '../../config/env.js';
import { brevoEmailDispatcher } from './providers/brevo.dispatcher.js';
import { twilioSmsDispatcher } from './providers/twilio.dispatcher.js';
import {
  insertVerificationEvent,
  insertInAppNotificationRecord,
  markNotificationAsReadRecord,
  markAllNotificationsAsReadRecord,
  listInAppNotificationsRecord,
  findNotificationPreferenceRecord,
  upsertNotificationPreferenceRecord
} from './repository.js';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { emailSuppressions } from '../../db/schema/email-suppressions.js';
import { and, eq } from 'drizzle-orm';
import type {
  CreateInAppNotificationDTO,
  NotificationListQuery,
  UpdateNotificationPreferencesDTO
} from './types.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { notFound } from '../../lib/errors.js';

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  fromEmail?: string;
  fromName?: string;
  isMarketing?: boolean;
  tenantId?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  eventType?: string;
}

export interface SendOtpInput {
  phoneNumber: string;
  otp: string;
  purpose: string;
  expiresInMinutes: number;
  tenantId?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  eventType?: string;
}

export class NotificationService {
  async sendEmail(input: SendEmailInput) {
    const eventType = input.eventType || 'send';

    logger.info('[NotificationService] sendEmail requested via Outbox Queue', {
      to: input.to,
      subject: input.subject,
      isMarketing: input.isMarketing,
      tenantId: input.tenantId,
      correlationId: input.correlationId
    });

    // Determine category dynamically for compliance
    let category: 'transactional' | 'security' | 'billing' | 'system' | 'marketing' | 'campaign' | 'notification' = 'transactional';
    if (input.isMarketing) {
      category = 'marketing';
    } else if (eventType === 'campaign_sent') {
      category = 'campaign';
    } else {
      const subjectLower = input.subject.toLowerCase();
      if (
        subjectLower.includes('security') ||
        subjectLower.includes('verification') ||
        subjectLower.includes('otp') ||
        subjectLower.includes('login') ||
        subjectLower.includes('password') ||
        subjectLower.includes('suspicious') ||
        subjectLower.includes('lock')
      ) {
        category = 'security';
      } else if (
        subjectLower.includes('payment') ||
        subjectLower.includes('refund') ||
        subjectLower.includes('withdrawal') ||
        subjectLower.includes('invoice') ||
        subjectLower.includes('receipt') ||
        subjectLower.includes('settlement')
      ) {
        category = 'billing';
      } else if (subjectLower.includes('alert') || subjectLower.includes('reminder')) {
        category = 'notification';
      }
    }

    const { emailClient } = await import('../../lib/email-client.js');
    const deliveryId = await emailClient.enqueue({
      tenantId: input.tenantId || '00000000-0000-0000-0000-000000000000',
      userId: input.actorUserId || null,
      recipientEmail: input.to,
      subject: input.subject,
      htmlContent: input.htmlContent,
      textContent: input.textContent,
      category,
      metadata: {
        correlationId: input.correlationId,
        requestId: input.requestId,
        eventType
      }
    });

    if (deliveryId === 'skipped_suppressed' || deliveryId === 'skipped_unsubscribed') {
      return {
        status: 'skipped',
        providerMessageId: undefined,
        responseRaw: `Skipped: ${deliveryId}`
      };
    }

    return {
      status: 'sent',
      providerMessageId: deliveryId,
      responseRaw: JSON.stringify({ deliveryId })
    };
  }

  async sendOtp(input: SendOtpInput) {
    const provider = env.SMS_PROVIDER;
    const eventType = input.eventType || 'send';
    // Code-first so mobile OS one-time-code autofill reliably detects it, with a
    // plain security notice. No decorative characters.
    const message = `${input.otp} is your Revelis verification code. It is valid for ${input.expiresInMinutes} minutes. Do not share this code with anyone — Revelis will never ask for it.`;

    logger.info('[NotificationService] sendOtp requested', {
      phoneNumber: input.phoneNumber,
      purpose: input.purpose,
      tenantId: input.tenantId,
      correlationId: input.correlationId
    });

    // 1. Dispatch
    const dispatcher = twilioSmsDispatcher;
    const result = await dispatcher.dispatch({
      phoneNumber: input.phoneNumber,
      message,
      metadata: { correlationId: input.correlationId }
    });

    // 2. Audit logging
    await insertVerificationEvent(db, {
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      eventType,
      source: 'otp',
      phoneNumber: input.phoneNumber,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      provider,
      providerMessageId: result.providerMessageId,
      providerStatus: result.status,
      providerResponse: result.responseRaw,
      correlationId: input.correlationId,
      requestId: input.requestId,
      metadata: { purpose: input.purpose, expiresInMinutes: input.expiresInMinutes }
    });

    return result;
  }

  async checkSuppression(email: string, tenantId?: string | null): Promise<boolean> {
    try {
      const conditions = [eq(emailSuppressions.email, email.trim().toLowerCase())];
      if (tenantId) {
        conditions.push(eq(emailSuppressions.tenantId, tenantId));
      }
      
      const rows = await db
        .select()
        .from(emailSuppressions)
        .where(and(...conditions))
        .limit(1);

      return rows.length > 0;
    } catch (error) {
      logger.error('Failed to check email suppression table', { email, tenantId, error });
      return false;
    }
  }
}

export const notificationService = new NotificationService();

// Standalone in-app notification services used by other modules
export async function createInAppNotification(input: CreateInAppNotificationDTO) {
  // Check preferences first
  const preferences = await findNotificationPreferenceRecord(db, input.tenantId, input.userId);
  if (preferences && preferences.inAppEnabled === false) {
    logger.info('[createInAppNotification] skipped due to user preference settings', { userId: input.userId });
    return null;
  }

  const notification = await insertInAppNotificationRecord(db, input);
  return notification;
}

export async function markAsRead(tenantId: string, userId: string, id: string) {
  const notification = await markNotificationAsReadRecord(db, tenantId, userId, id);
  if (!notification) {
    throw notFound('Unread notification not found');
  }
  return notification;
}

export async function markAllAsRead(tenantId: string, userId: string) {
  const rows = await markAllNotificationsAsReadRecord(db, tenantId, userId);
  return { updatedCount: rows.length };
}

export async function getInAppNotifications(
  tenantId: string,
  userId: string,
  query: NotificationListQuery
) {
  const pagination = parsePagination(query);
  const { rows, total } = await listInAppNotificationsRecord(db, tenantId, userId, query.isRead, pagination);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getPreferences(tenantId: string, userId: string) {
  let pref = await findNotificationPreferenceRecord(db, tenantId, userId);
  if (!pref) {
    // Create defaults
    pref = await upsertNotificationPreferenceRecord(db, tenantId, userId, {
      emailEnabled: true,
      smsEnabled: true,
      inAppEnabled: true,
      preferences: {}
    });
  }
  return pref;
}

export async function updatePreferences(
  tenantId: string,
  userId: string,
  input: UpdateNotificationPreferencesDTO
) {
  const pref = await upsertNotificationPreferenceRecord(db, tenantId, userId, input);
  return pref;
}
