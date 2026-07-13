import { and, eq, count, countDistinct } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { emailCampaignRecipients } from '../../db/schema/email-campaign-recipients.js';
import { emailDeliveries } from '../../db/schema/email-deliveries.js';
import { emailEvents } from '../../db/schema/email-events.js';
import { notFound } from '../../lib/errors.js';
import { emailsRepository } from './repository.js';

export interface CampaignAnalytics {
  campaignId: string;
  sent: number;
  delivered: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  bounces: number;
  complaints: number;
  unsubscribes: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  unsubscribeRate: number;
}

export class EmailsAnalytics {
  async getCampaignAnalytics(tenantId: string, campaignId: string): Promise<CampaignAnalytics> {
    const campaign = await emailsRepository.findCampaignById(db, tenantId, campaignId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }

    // 1. Fetch count stats from email_campaign_recipients
    // Total Sent
    const [sentRow] = await db
      .select({ val: count(emailCampaignRecipients.id) })
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.campaignId, campaignId));
    const sent = sentRow?.val || 0;

    // Total Delivered
    const [deliveredRow] = await db
      .select({ val: count(emailCampaignRecipients.id) })
      .from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, 'delivered')));
    const delivered = deliveredRow?.val || 0;

    // Bounces
    const [bounceRow] = await db
      .select({ val: count(emailCampaignRecipients.id) })
      .from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, 'bounced')));
    const bounces = bounceRow?.val || 0;

    // 2. Fetch tracking details from email_events
    // Total Opens (opened event)
    const [opensRow] = await db
      .select({ val: count(emailEvents.id) })
      .from(emailEvents)
      .where(and(eq(emailEvents.campaignId, campaignId), eq(emailEvents.eventType, 'opened')));
    const opens = opensRow?.val || 0;

    // Unique Opens (opens distinct by recipient)
    const [uniqOpensRow] = await db
      .select({ val: countDistinct(emailEvents.recipientId) })
      .from(emailEvents)
      .where(and(eq(emailEvents.campaignId, campaignId), eq(emailEvents.eventType, 'opened')));
    const uniqueOpens = uniqOpensRow?.val || 0;

    // Total Clicks
    const [clicksRow] = await db
      .select({ val: count(emailEvents.id) })
      .from(emailEvents)
      .where(and(eq(emailEvents.campaignId, campaignId), eq(emailEvents.eventType, 'clicked')));
    const clicks = clicksRow?.val || 0;

    // Unique Clicks
    const [uniqClicksRow] = await db
      .select({ val: countDistinct(emailEvents.recipientId) })
      .from(emailEvents)
      .where(and(eq(emailEvents.campaignId, campaignId), eq(emailEvents.eventType, 'clicked')));
    const uniqueClicks = uniqClicksRow?.val || 0;

    // Complaints / Spam reports
    const [complaintsRow] = await db
      .select({ val: count(emailEvents.id) })
      .from(emailEvents)
      .where(and(eq(emailEvents.campaignId, campaignId), eq(emailEvents.eventType, 'complaint')));
    const complaints = complaintsRow?.val || 0;

    // Unsubscribes triggered from this campaign
    const [unsubsRow] = await db
      .select({ val: count(emailEvents.id) })
      .from(emailEvents)
      .where(and(eq(emailEvents.campaignId, campaignId), eq(emailEvents.eventType, 'unsubscribe')));
    const unsubscribes = unsubsRow?.val || 0;

    // 3. Rates Calculations
    const deliveryRate = sent > 0 ? Number(((delivered / sent) * 100).toFixed(2)) : 0;
    const openRate = delivered > 0 ? Number(((uniqueOpens / delivered) * 100).toFixed(2)) : 0;
    const clickRate = delivered > 0 ? Number(((uniqueClicks / delivered) * 100).toFixed(2)) : 0;
    const bounceRate = sent > 0 ? Number(((bounces / sent) * 100).toFixed(2)) : 0;
    const unsubscribeRate = delivered > 0 ? Number(((unsubscribes / delivered) * 100).toFixed(2)) : 0;

    return {
      campaignId,
      sent,
      delivered,
      opens,
      uniqueOpens,
      clicks,
      uniqueClicks,
      bounces,
      complaints,
      unsubscribes,
      deliveryRate,
      openRate,
      clickRate,
      bounceRate,
      unsubscribeRate
    };
  }

  async getCampaignDeliveries(tenantId: string, campaignId: string) {
    const campaign = await emailsRepository.findCampaignById(db, tenantId, campaignId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }

    return db
      .select()
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.campaignId, campaignId));
  }

  async getCampaignEvents(tenantId: string, campaignId: string) {
    const campaign = await emailsRepository.findCampaignById(db, tenantId, campaignId);
    if (!campaign) {
      throw notFound('Campaign not found');
    }

    return db
      .select()
      .from(emailEvents)
      .where(eq(emailEvents.campaignId, campaignId));
  }
}

export const emailsAnalytics = new EmailsAnalytics();
