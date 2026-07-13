import { db } from '../db/client.js';
import { emailDeliveries } from '../db/schema/email-deliveries.js';
import { emailPreferences } from '../db/schema/email-preferences.js';
import { emailSuppressions } from '../db/schema/email-suppressions.js';
import { qstashService } from './qstash.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export type EmailCategory = 'transactional' | 'security' | 'billing' | 'system' | 'marketing' | 'campaign' | 'notification';

export interface EnqueueEmailInput {
  tenantId: string;
  userId?: string | null;
  recipientEmail: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  category: EmailCategory;
  metadata?: Record<string, any>;
}

export class EmailClient {
  private static instance: EmailClient | null = null;

  private constructor() {}

  public static getInstance(): EmailClient {
    if (!EmailClient.instance) {
      EmailClient.instance = new EmailClient();
    }
    return EmailClient.instance;
  }

  /**
   * Enqueues an email for delivery (Outbox Pattern)
   */
  public async enqueue(input: EnqueueEmailInput, txConnection: any = db): Promise<string> {
    const category = input.category;
    const email = input.recipientEmail.trim().toLowerCase();

    // Enforce Category & Compliance Rules
    const isBypass = ['transactional', 'security', 'billing', 'system'].includes(category);

    if (!isBypass) {
      // 1. Check Category-Level Subscriptions in Preferences Center
      const [prefs] = await txConnection
        .select()
        .from(emailPreferences)
        .where(
          and(
            eq(emailPreferences.tenantId, input.tenantId),
            eq(emailPreferences.email, email)
          )
        )
        .limit(1);

      if (prefs) {
        let isSubscribed = true;
        if (category === 'marketing' && !prefs.marketing) isSubscribed = false;
        if (category === 'campaign' && !prefs.campaign) isSubscribed = false;
        if (category === 'notification' && !prefs.notification) isSubscribed = false;

        if (!isSubscribed) {
          logger.info(`[EmailClient] Send skipped: recipient unsubscribed from category '${category}'`, { email, tenantId: input.tenantId });
          return 'skipped_unsubscribed';
        }
      }

      // 2. Check Global Suppression List
      // Individual suppression or domain suppression matching the domain of the email
      const emailDomain = email.split('@')[1];
      const conditions = [
        and(
          eq(emailSuppressions.tenantId, input.tenantId),
          eq(emailSuppressions.email, email),
          eq(emailSuppressions.scope, 'individual')
        )
      ];
      
      if (emailDomain) {
        conditions.push(
          and(
            eq(emailSuppressions.tenantId, input.tenantId),
            eq(emailSuppressions.email, emailDomain),
            eq(emailSuppressions.scope, 'domain')
          )
        );
      }

      const suppressions = await txConnection
        .select()
        .from(emailSuppressions)
        .where(or(...conditions))
        .limit(1);

      if (suppressions.length > 0) {
        logger.warn(`[EmailClient] Send skipped: recipient email or domain is present in suppressions list`, { email, tenantId: input.tenantId, reason: suppressions[0].reason });
        return 'skipped_suppressed';
      }
    }

    // 3. Write to DB Outbox (email_deliveries)
    const [delivery] = await txConnection
      .insert(emailDeliveries)
      .values({
        tenantId: input.tenantId,
        userId: input.userId || null,
        recipientEmail: email,
        subject: input.subject,
        htmlContent: input.htmlContent,
        textContent: input.textContent || null,
        category,
        status: 'pending',
        metadata: input.metadata || {},
        retryCount: 0,
        maxRetries: env.EMAIL_MAX_RETRIES || 5
      })
      .returning();

    logger.info(`[EmailClient] Email queued in Outbox`, { deliveryId: delivery.id, recipientEmail: email, category });

    // 4. Trigger QStash Processor Job (Asynchronous execution outside request context)
    const targetUrl = `${env.EMAIL_PUBLIC_URL || 'http://localhost:3000'}/qstash/jobs`;
    const payload = {
      jobType: 'process_delivery',
      data: { deliveryId: delivery.id }
    };

    // We trigger QStash immediately. If QStash service is not configured (e.g. in dev / tests),
    // we simulate processing to allow tests to run synchronously or log warnings.
    if (env.QSTASH_TOKEN) {
      qstashService.publish(targetUrl, payload).catch((err) => {
        logger.error('[EmailClient] Failed to publish delivery trigger to QStash', { deliveryId: delivery.id, error: err.message });
      });
    } else {
      // Simulated delivery processing in non-production local debug environments where QStash isn't initialized
      logger.info(`[EmailClient] QStash token not configured. Simulating outbox trigger.`, { deliveryId: delivery.id });
      // In tests/local dev we might want to let the smoke test run it directly
    }

    return delivery.id;
  }
}

export const emailClient = EmailClient.getInstance();
