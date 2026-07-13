import { db } from '../../db/client.js';
import { forbidden, notFound, badRequest } from '../../lib/errors.js';
import { parsePagination, buildPaginationMeta } from '../../lib/pagination.js';
import {
  createCampaignRecord,
  findCampaignById,
  updateCampaignRecord,
  listCampaignsForTenant,
  getCampaignSubscribers,
  createDeliveryRecords,
  getCampaignAnalyticsData
} from './repository.js';
import { notificationService } from '../notifications/service.js';
import { renderEmailTemplate } from '../../lib/email/templates.js';
import { insertVerificationEvent } from '../notifications/repository.js';
import { marketingHooks } from '../marketing/hooks.js';
import { env } from '../../config/env.js';
import type { CreateCampaignInput, UpdateCampaignInput, ScheduleCampaignInput, ListCampaignsQueryInput } from './validation.js';

export class MarketingCampaignsService {
  async createCampaign(tenantId: string, createdBy: string, input: CreateCampaignInput) {
    const campaign = await db.transaction(async (tx) => {
      const created = await createCampaignRecord(tx, {
        tenantId,
        name: input.name,
        subject: input.subject,
        templateType: input.templateType,
        status: 'draft',
        createdBy,
        metadata: input.metadata
      });

      await insertVerificationEvent(tx, {
        actorUserId: createdBy,
        tenantId,
        eventType: 'campaign_created',
        source: 'marketing',
        metadata: { campaignId: created?.id, name: input.name }
      });

      return created;
    });

    return campaign;
  }

  async updateCampaign(id: string, tenantId: string, input: UpdateCampaignInput) {
    const campaign = await findCampaignById(db, id, tenantId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }
    if (campaign.status !== 'draft') {
      throw badRequest('Only campaigns in draft status can be modified');
    }

    const updated = await updateCampaignRecord(db, id, tenantId, input);
    return updated;
  }

  async scheduleCampaign(id: string, tenantId: string, input: ScheduleCampaignInput) {
    const campaign = await findCampaignById(db, id, tenantId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }
    if (campaign.status !== 'draft') {
      throw badRequest('Only draft campaigns can be scheduled');
    }

    const scheduled = await updateCampaignRecord(db, id, tenantId, {
      status: 'scheduled',
      scheduledAt: new Date(input.scheduledAt)
    });

    await insertVerificationEvent(db, {
      tenantId,
      eventType: 'campaign_scheduled',
      source: 'marketing',
      metadata: { campaignId: id, scheduledAt: input.scheduledAt }
    });

    return scheduled;
  }

  async cancelCampaign(id: string, tenantId: string) {
    const campaign = await findCampaignById(db, id, tenantId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }
    if (campaign.status !== 'scheduled') {
      throw badRequest('Only scheduled campaigns can be cancelled');
    }

    const cancelled = await updateCampaignRecord(db, id, tenantId, {
      status: 'cancelled',
      scheduledAt: null
    });

    await insertVerificationEvent(db, {
      tenantId,
      eventType: 'campaign_cancelled',
      source: 'marketing',
      metadata: { campaignId: id }
    });

    return cancelled;
  }

  async previewCampaign(id: string, tenantId: string, email: string) {
    const campaign = await findCampaignById(db, id, tenantId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }

    // Render verification or other template types
    const branding = await this.getTenantBranding(tenantId);
    const variables = {
      user: { fullName: 'Preview User', email },
      event: { title: 'Amazing Event Preview', startDate: new Date().toLocaleDateString(), location: 'Virtual Arena' },
      otp: '123456',
      purpose: 'preview',
      expiryMinutes: 10,
      verificationLink: 'http://localhost:3000/auth/verify-email?token=preview',
      expiryHours: 24,
      newsletter: { title: 'Monthly Highlights Preview', bodyHtml: '<p>This is the preview HTML body.</p>', text: 'This is the preview text.' },
      unsubscribeUrl: 'http://localhost:3000/marketing/unsubscribe?email=preview'
    };

    const rendered = renderEmailTemplate(campaign.templateType, variables, branding);
    return rendered;
  }

  async sendCampaign(id: string, tenantId: string, currentUserId: string) {
    const campaign = await findCampaignById(db, id, tenantId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw badRequest('Only draft or scheduled campaigns can be sent');
    }

    // 1. Mark campaign as sending
    await updateCampaignRecord(db, id, tenantId, { status: 'sending' });

    // 2. Fetch subscribers
    const subscribers = await getCampaignSubscribers(db, tenantId);
    const deliveries: any[] = [];

    // 3. Process sends
    const branding = await this.getTenantBranding(tenantId);

    for (const sub of subscribers) {
      const isSuppressed = await notificationService.checkSuppression(sub.email, tenantId);
      
      if (isSuppressed) {
        deliveries.push({
          campaignId: id,
          subscriberId: sub.id,
          email: sub.email,
          deliveryStatus: 'unsubscribed',
          providerMessageId: null,
          metadata: { reason: 'suppressed' }
        });
        continue;
      }

      const variables = {
        user: { fullName: `${sub.firstName || ''} ${sub.lastName || ''}`.trim() || null, email: sub.email },
        subscriber: { email: sub.email, firstName: sub.firstName, lastName: sub.lastName },
        unsubscribeUrl: `${env.CORS_ORIGINS?.[0] || 'http://localhost:3000'}/marketing/unsubscribe?email=${sub.email}&tenantId=${tenantId}`,
        newsletter: {
          title: campaign.name,
          bodyHtml: `<p>Hello ${sub.firstName || 'Subscriber'},</p><p>Welcome to our newsletter: ${campaign.subject}</p>`,
          text: `Hello ${sub.firstName || 'Subscriber'},\n\nWelcome to our newsletter: ${campaign.subject}`
        }
      };

      try {
        const rendered = renderEmailTemplate(campaign.templateType, variables, branding);
        const result = await notificationService.sendEmail({
          to: sub.email,
          subject: campaign.subject,
          htmlContent: rendered.htmlContent,
          textContent: rendered.textContent,
          isMarketing: true,
          tenantId,
          actorUserId: currentUserId,
          eventType: 'campaign_sent'
        });

        deliveries.push({
          campaignId: id,
          subscriberId: sub.id,
          email: sub.email,
          deliveryStatus: result.status === 'sent' || result.status === 'simulated_success' ? 'sent' : 'failed',
          providerMessageId: result.providerMessageId || null,
          metadata: { response: result.responseRaw }
        });
      } catch (error: any) {
        deliveries.push({
          campaignId: id,
          subscriberId: sub.id,
          email: sub.email,
          deliveryStatus: 'failed',
          providerMessageId: null,
          metadata: { error: error instanceof Error ? error.message : String(error) }
        });
      }
    }

    // 4. Save delivery records & update campaign to completed
    await db.transaction(async (tx) => {
      await createDeliveryRecords(tx, deliveries);
      await updateCampaignRecord(tx, id, tenantId, {
        status: 'completed',
        sentAt: new Date()
      });

      await insertVerificationEvent(tx, {
        actorUserId: currentUserId,
        tenantId,
        eventType: 'campaign_sent',
        source: 'marketing',
        metadata: { campaignId: id, subscribersCount: subscribers.length, deliveriesCount: deliveries.length }
      });
    });

    // 5. Trigger Hook
    await marketingHooks.onEventPublished({ id, name: campaign.name } as any, { tenantId });

    return { success: true, processedCount: deliveries.length };
  }

  async listCampaigns(tenantId: string, query: ListCampaignsQueryInput) {
    const pagination = parsePagination(query);
    const { rows, total } = await listCampaignsForTenant(
      db,
      tenantId,
      { status: query.status },
      pagination
    );

    return {
      items: rows,
      meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
    };
  }

  async getCampaignAnalytics(id: string, tenantId: string) {
    const campaign = await findCampaignById(db, id, tenantId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }

    const data = await getCampaignAnalyticsData(db, id);
    return data;
  }

  private async getTenantBranding(tenantId: string) {
    try {
      const { findTenantById } = await import('../tenants/repository.js');
      const tenant = await findTenantById(db, tenantId);
      if (tenant) {
        return {
          name: tenant.name,
          logoUrl: null,
          primaryColor: '#4F46E5',
          website: tenant.website || '#'
        };
      }
    } catch {}
    return null;
  }
}

export const marketingCampaignsService = new MarketingCampaignsService();
