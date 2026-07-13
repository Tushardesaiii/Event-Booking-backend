import { db } from '../../db/client.js';
import { emailsRepository } from './repository.js';
import { preferencesService } from './preferences.service.js';
import { resolveSegmentSubscribers } from '../email-marketing/services/segment-query.service.js';
import { tenants } from '../../db/schema/tenants.js';
import { emailCampaigns } from '../../db/schema/email-campaigns.js';
import { emailClient } from '../../lib/email-client.js';
import { renderEmail } from '../../lib/email-templates.js';
import { badRequest, notFound, conflict } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { incrementMetric } from '../../lib/metrics.js';
import { qstashService } from '../../lib/qstash.js';
import { env } from '../../config/env.js';
import { eq, and, sql } from 'drizzle-orm';

const MAX_RECIPIENTS_PER_CAMPAIGN = 10000;

export class CampaignService {
  async createCampaign(tenantId: string, createdByUserId: string, data: { name: string; subject: string; templateId?: string | null; segmentId?: string | null; audienceFiltersJson?: any }) {
    // 1. Accidental duplicate detection (duplicate campaign name/subject in the last 5 minutes)
    const recentDuplicate = await db
      .select()
      .from(emailCampaigns)
      .where(
        and(
          eq(emailCampaigns.tenantId, tenantId),
          eq(emailCampaigns.name, data.name),
          sql`created_at > now() - interval '5 minutes'`
        )
      )
      .limit(1);

    if (recentDuplicate.length > 0) {
      throw conflict('A campaign with the same name was created within the last 5 minutes. Potential duplicate prevented.');
    }

    const campaign = await emailsRepository.createCampaign(db, tenantId, createdByUserId, data);
    incrementMetric('campaigns_created_total');
    return campaign;
  }

  async getCampaign(tenantId: string, id: string) {
    const campaign = await emailsRepository.findCampaignById(db, tenantId, id);
    if (!campaign) throw notFound('Campaign not found');
    return campaign;
  }

  async updateCampaign(tenantId: string, id: string, data: any) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status !== 'draft') {
      throw badRequest('Only draft campaigns can be updated');
    }
    return emailsRepository.updateCampaign(db, tenantId, id, data);
  }

  async listCampaigns(tenantId: string) {
    return emailsRepository.listCampaigns(db, tenantId);
  }

  async duplicateCampaign(tenantId: string, id: string, createdByUserId: string) {
    const campaign = await this.getCampaign(tenantId, id);
    return this.createCampaign(tenantId, createdByUserId, {
      name: `Copy of ${campaign.name} - ${Date.now()}`,
      subject: campaign.subject,
      templateId: campaign.templateId,
      segmentId: campaign.segmentId,
      audienceFiltersJson: campaign.audienceFiltersJson
    });
  }

  async scheduleCampaign(tenantId: string, id: string, scheduledAtStr: string, userId: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status !== 'draft') {
      throw badRequest('Only draft campaigns can be scheduled');
    }

    const scheduledAt = new Date(scheduledAtStr);
    if (scheduledAt <= new Date()) {
      throw badRequest('Scheduled time must be in the future');
    }

    // Update campaign state
    const updated = await emailsRepository.updateCampaign(db, tenantId, id, {
      status: 'scheduled',
      scheduledAt
    });

    // Register delayed job in QStash
    if (env.QSTASH_TOKEN) {
      const targetUrl = `${env.EMAIL_PUBLIC_URL}/qstash/jobs`;
      const delaySeconds = Math.max(1, Math.round((scheduledAt.getTime() - Date.now()) / 1000));
      
      const payload = {
        jobType: 'process_campaign_execute',
        data: { campaignId: id, tenantId }
      };

      await qstashService.publish(targetUrl, payload, { delaySeconds });
      logger.info('[CampaignService] Campaign scheduled via QStash delay', { campaignId: id, delaySeconds });
    }

    return updated;
  }

  async pauseCampaign(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status !== 'scheduled') {
      throw badRequest('Only scheduled campaigns can be paused');
    }

    return emailsRepository.updateCampaign(db, tenantId, id, {
      status: 'draft',
      scheduledAt: null
    });
  }

  async archiveCampaign(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status === 'sending') {
      throw badRequest('Cannot archive a campaign while it is actively sending');
    }

    return emailsRepository.updateCampaign(db, tenantId, id, {
      deletedAt: new Date()
    });
  }

  async cancelCampaign(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status !== 'scheduled') {
      throw badRequest('Only scheduled campaigns can be cancelled');
    }

    return emailsRepository.updateCampaign(db, tenantId, id, {
      status: 'cancelled',
      cancelledAt: new Date(),
      scheduledAt: null
    });
  }

  async executeCampaignImmediate(tenantId: string, id: string, userId: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw badRequest('Only draft or scheduled campaigns can be executed immediately');
    }

    // Transition state
    await emailsRepository.updateCampaign(db, tenantId, id, {
      status: 'sending',
      startedAt: new Date()
    });

    // Run execution asynchronously through QStash
    const targetUrl = `${env.EMAIL_PUBLIC_URL || 'http://localhost:3000'}/qstash/jobs`;
    const payload = {
      jobType: 'process_campaign_execute',
      data: { campaignId: id, tenantId }
    };

    if (env.QSTASH_TOKEN) {
      await qstashService.publish(targetUrl, payload);
    } else {
      // Direct local call in dev if QStash is missing
      logger.info('[CampaignService] Executing campaign locally (no QStash token)', { campaignId: id });
      this.executeCampaignSnapshotAndSend(tenantId, id).catch(err => {
        logger.error('[CampaignService] Local execution failed', { campaignId: id, error: err.message });
      });
    }

    return { success: true, status: 'sending' };
  }

  /**
   * Performs campaign subscriber resolution, creates immutable audience snapshots,
   * compiles template variations, and enqueues outbox items for all recipients.
   */
  async executeCampaignSnapshotAndSend(tenantId: string, campaignId: string) {
    const campaign = await emailsRepository.findCampaignById(db, tenantId, campaignId);
    if (!campaign) return;

    if (campaign.status !== 'sending') {
      logger.warn('[CampaignService] Campaign execution aborted: status is not sending', { campaignId });
      return;
    }

    // 1. Fetch Segment / Filters
    let filters = campaign.audienceFiltersJson;
    if (campaign.segmentId) {
      const segment = await db
        .select()
        .from(require('../../db/schema/email-segments.js').emailSegments)
        .where(eq(require('../../db/schema/email-segments.js').emailSegments.id, campaign.segmentId))
        .limit(1)
        .then(res => res[0]);
      if (segment) {
        filters = segment.filtersJson;
      }
    }

    // 2. Resolve subscribers
    const subscribers = await resolveSegmentSubscribers(db, tenantId, filters as any);

    if (subscribers.length === 0) {
      logger.info('[CampaignService] Campaign target audience resolved to 0 recipients.', { campaignId });
      await emailsRepository.updateCampaign(db, tenantId, campaignId, {
        status: 'sent',
        completedAt: new Date()
      });
      return;
    }

    // Safety Checks: Accidental resend & Max limits
    if (subscribers.length > MAX_RECIPIENTS_PER_CAMPAIGN) {
      logger.error('[CampaignService] Campaign aborted: audience size exceeds safety threshold', { campaignId, size: subscribers.length });
      await emailsRepository.updateCampaign(db, tenantId, campaignId, {
        status: 'failed',
        completedAt: new Date()
      });
      incrementMetric('campaigns_failed_total');
      return;
    }

    // 3. Store Immutable Campaign Recipient Snapshot
    const recipientsPayload = subscribers.map(sub => ({
      tenantId,
      campaignId,
      subscriberId: sub.id,
      status: 'pending' as const
    }));

    const snapshot = await emailsRepository.createCampaignRecipientsSnapshot(db, recipientsPayload);

    // Fetch template details & Tenant branding
    if (!campaign.templateId) {
      throw new Error('Campaign template is not configured');
    }
    const template = await emailsRepository.findTemplateById(db, tenantId, campaign.templateId);
    if (!template) {
      throw new Error('Campaign template record not found');
    }

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const branding = tenant ? {
      name: tenant.name,
      logoUrl: null,
      primaryColor: '#4F46E5',
      website: tenant.website || '#'
    } : null;

    // 4. Batch enqueue sends in transactions (Outbox Pattern)
    // Send in chunks of 50 to maintain database stability and avoid huge transactions
    const chunkSize = 50;
    for (let i = 0; i < snapshot.length; i += chunkSize) {
      const chunk = snapshot.slice(i, i + chunkSize);
      await db.transaction(async (tx) => {
        for (const recipient of chunk) {
          const sub = subscribers.find(s => s.id === recipient.subscriberId)!;
          
          const unsubscribeUrl = `${env.EMAIL_PUBLIC_URL || 'http://localhost:3000'}/email/unsubscribe?token=${preferencesService.generateUnsubscribeToken(tenantId, sub.email)}`;

          const variables = {
            subscriber: {
              firstName: sub.firstName || '',
              lastName: sub.lastName || '',
              email: sub.email
            },
            newsletter: {
              title: campaign.name,
              bodyHtml: template.htmlContent,
              text: template.textContent || ''
            },
            unsubscribeUrl
          };

          const rendered = renderEmail('newsletter', variables, branding);

          // We insert directly into emailDeliveries queue (Outbox) using the transaction connection
          await emailClient.enqueue({
            tenantId,
            userId: sub.userId,
            recipientEmail: sub.email,
            subject: rendered.subject,
            htmlContent: rendered.htmlContent,
            textContent: rendered.textContent,
            category: 'campaign',
            metadata: { campaignId, recipientId: recipient.id }
          }, tx);
        }
      });
    }

    // 5. Finalize campaign state
    await emailsRepository.updateCampaign(db, tenantId, campaignId, {
      status: 'sent',
      completedAt: new Date()
    });

    incrementMetric('campaigns_sent_total');
    logger.info('[CampaignService] Campaign execution completed successfully', { campaignId, totalSent: snapshot.length });
  }
}

export const campaignService = new CampaignService();
