import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants } from '../../db/schema/tenants.js';
import { emailCampaigns } from '../../db/schema/email-campaigns.js';
import { emailSubscribers } from '../../db/schema/email-subscribers.js';
import { emailCampaignRecipients } from '../../db/schema/email-campaign-recipients.js';
import { emailOutbox } from '../../db/schema/email-outbox.js';
import { auditLogs } from '../../db/schema/audit-logs.js';
import { renderTemplate } from '../../lib/email/template-engine.js';
import { resolveSegmentSubscribers } from './services/segment-query.service.js';
import * as repository from './repository.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { normalizeBrevoWebhookEvent } from '../../lib/email/brevo.js';

// ==========================================
// TEMPLATES
// ==========================================
export async function createTemplate(tenantId: string, input: { name: string; subject: string; htmlContent: string; textContent?: string }) {
  return repository.createTemplate(db, tenantId, input);
}

export async function updateTemplate(tenantId: string, id: string, input: Partial<{ name: string; subject: string; htmlContent: string; textContent: string | null; isActive: boolean }>) {
  const template = await repository.updateTemplate(db, tenantId, id, input);
  if (!template) throw notFound('Template not found');
  return template;
}

export async function getTemplate(tenantId: string, id: string) {
  const template = await repository.findTemplateById(db, tenantId, id);
  if (!template) throw notFound('Template not found');
  return template;
}

export async function getTemplates(tenantId: string) {
  return repository.listTemplates(db, tenantId);
}

export async function deleteTemplate(tenantId: string, id: string) {
  const template = await repository.deleteTemplate(db, tenantId, id);
  if (!template) throw notFound('Template not found');
  return template;
}

// ==========================================
// SUBSCRIBERS & CSV IMPORT
// ==========================================
export async function subscribeUser(tenantId: string, input: { email: string; firstName?: string; lastName?: string; source?: string; userId?: string }) {
  const existing = await repository.findSubscriberByEmail(db, tenantId, input.email);
  if (existing) {
    // If unsubscribed or bounced, we resubscribe them
    return repository.updateSubscriber(db, tenantId, existing.id, {
      status: 'subscribed',
      unsubscribedAt: null,
      firstName: input.firstName || existing.firstName,
      lastName: input.lastName || existing.lastName
    });
  }
  return repository.createSubscriber(db, tenantId, input);
}

export async function unsubscribeUser(tenantId: string, email: string) {
  const subscriber = await repository.findSubscriberByEmail(db, tenantId, email);
  if (!subscriber) throw notFound('Subscriber not found');

  // Update subscriber status
  await repository.updateSubscriber(db, tenantId, subscriber.id, {
    status: 'unsubscribed',
    unsubscribedAt: new Date()
  });

  // Add suppression
  await repository.addSuppression(db, {
    tenantId,
    subscriberId: subscriber.id,
    email: subscriber.email,
    reason: 'unsubscribe',
    source: 'user_action'
  });

  return { success: true };
}

export async function getSubscribers(tenantId: string) {
  return repository.listSubscribers(db, tenantId);
}

export async function importSubscribersFromCsv(tenantId: string, subscribers: { email: string; firstName?: string | null; lastName?: string | null }[]) {
  if (subscribers.length === 0) {
    throw badRequest('Subscribers list cannot be empty');
  }
  const normalized = subscribers.map(s => ({
    email: s.email,
    firstName: s.firstName,
    lastName: s.lastName,
    source: 'csv_import'
  }));
  return repository.batchUpsertSubscribers(db, tenantId, normalized);
}

// ==========================================
// SEGMENTS
// ==========================================
export async function createSegment(tenantId: string, input: { name: string; description?: string; filters: any }) {
  return repository.createSegment(db, tenantId, input);
}

export async function updateSegment(tenantId: string, id: string, input: Partial<{ name: string; description: string | null; filtersJson: any }>) {
  const segment = await repository.updateSegment(db, tenantId, id, input);
  if (!segment) throw notFound('Segment not found');
  return segment;
}

export async function getSegment(tenantId: string, id: string) {
  const segment = await repository.findSegmentById(db, tenantId, id);
  if (!segment) throw notFound('Segment not found');
  return segment;
}

export async function getSegments(tenantId: string) {
  return repository.listSegments(db, tenantId);
}

export async function deleteSegment(tenantId: string, id: string) {
  const segment = await repository.deleteSegment(db, tenantId, id);
  if (!segment) throw notFound('Segment not found');
  return segment;
}

// ==========================================
// CAMPAIGNS & LIFECYCLE
// ==========================================
export async function createCampaign(tenantId: string, createdByUserId: string, input: { name: string; subject: string; templateId?: string | null; segmentId?: string | null; audienceFiltersJson?: any }) {
  const campaign = await repository.createCampaign(db, tenantId, { ...input, createdByUserId });
  
  // Audit Log
  await db.insert(auditLogs).values({
    eventType: 'campaign_created',
    actorType: 'user',
    actorUserId: createdByUserId,
    entityType: 'email_campaigns',
    entityId: campaign.id,
    correlationId: `campaign_create_${campaign.id}`,
    metadata: { name: campaign.name }
  });

  return campaign;
}

export async function updateCampaign(tenantId: string, id: string, input: Partial<{ name: string; subject: string; templateId: string | null; segmentId: string | null; audienceFiltersJson: any }>) {
  const campaign = await repository.findCampaignById(db, tenantId, id);
  if (!campaign) throw notFound('Campaign not found');
  if (campaign.status !== 'draft') {
    throw badRequest('Only draft campaigns can be modified');
  }
  return repository.updateCampaign(db, tenantId, id, input);
}

export async function getCampaign(tenantId: string, id: string) {
  const campaign = await repository.findCampaignById(db, tenantId, id);
  if (!campaign) throw notFound('Campaign not found');
  return campaign;
}

export async function getCampaigns(tenantId: string) {
  return repository.listCampaigns(db, tenantId);
}

export async function deleteCampaign(tenantId: string, id: string) {
  const campaign = await repository.findCampaignById(db, tenantId, id);
  if (!campaign) throw notFound('Campaign not found');
  if (campaign.status === 'sending') {
    throw badRequest('Cannot delete a campaign currently sending');
  }
  return repository.deleteCampaign(db, tenantId, id);
}

export async function duplicateCampaign(tenantId: string, id: string, createdByUserId: string) {
  const campaign = await repository.findCampaignById(db, tenantId, id);
  if (!campaign) throw notFound('Campaign not found');

  return createCampaign(tenantId, createdByUserId, {
    name: `Copy of ${campaign.name}`,
    subject: campaign.subject,
    templateId: campaign.templateId,
    segmentId: campaign.segmentId,
    audienceFiltersJson: campaign.audienceFiltersJson
  });
}

export async function scheduleCampaign(tenantId: string, id: string, scheduledAt: Date, userId: string) {
  const campaign = await repository.findCampaignById(db, tenantId, id);
  if (!campaign) throw notFound('Campaign not found');
  if (campaign.status !== 'draft') {
    throw badRequest('Only draft campaigns can be scheduled');
  }

  // Update status to scheduled
  const updated = await repository.updateCampaign(db, tenantId, id, {
    status: 'scheduled',
    scheduledAt
  });

  // Audit Log
  await db.insert(auditLogs).values({
    eventType: 'campaign_scheduled',
    actorType: 'user',
    actorUserId: userId,
    entityType: 'email_campaigns',
    entityId: id,
    correlationId: `campaign_schedule_${id}`,
    metadata: { scheduledAt }
  });

  // If scheduled execution time is in the past/immediate, trigger send
  if (scheduledAt <= new Date()) {
    executeCampaign(tenantId, id, userId).catch(console.error);
  }

  return updated;
}

export async function cancelCampaignSchedule(tenantId: string, id: string, userId: string) {
  const campaign = await repository.findCampaignById(db, tenantId, id);
  if (!campaign) throw notFound('Campaign not found');
  if (campaign.status !== 'scheduled') {
    throw badRequest('Campaign is not scheduled');
  }

  const updated = await repository.updateCampaign(db, tenantId, id, {
    status: 'draft',
    scheduledAt: null
  });

  // Audit Log
  await db.insert(auditLogs).values({
    eventType: 'campaign_cancelled',
    actorType: 'user',
    actorUserId: userId,
    entityType: 'email_campaigns',
    entityId: id,
    correlationId: `campaign_cancel_${id}`,
    metadata: {}
  });

  return updated;
}

/**
 * Resolves recipients, personalises templates, and schedules outbox queue sends for a campaign
 */
export async function executeCampaign(tenantId: string, campaignId: string, userId: string) {
  const campaign = await repository.findCampaignById(db, tenantId, campaignId);
  if (!campaign) throw notFound('Campaign not found');
  
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw badRequest('Campaign is already sending or sent');
  }

  // Fetch Template & Segment
  if (!campaign.templateId) {
    throw badRequest('Campaign requires an email template before execution');
  }
  const template = await repository.findTemplateById(db, tenantId, campaign.templateId);
  if (!template) throw notFound('Email template not found');

  // Resolve filters
  let filters = campaign.audienceFiltersJson;
  if (campaign.segmentId) {
    const segment = await repository.findSegmentById(db, tenantId, campaign.segmentId);
    if (segment) {
      filters = segment.filtersJson;
    }
  }

  if (!filters || Object.keys(filters).length === 0) {
    throw badRequest('Campaign has no target audience segment or filters configured');
  }

  // Fetch Tenant Context
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenantContext = tenant ? {
    name: tenant.name,
    slug: tenant.slug,
    website: tenant.website,
    city: tenant.city,
    country: tenant.country
  } : {};

  // 1. Transition campaign status to sending
  await repository.updateCampaign(db, tenantId, campaignId, {
    status: 'sending'
  });

  // 2. Fetch audience subscribers
  const subscribers = await resolveSegmentSubscribers(db, tenantId, filters as any);

  if (subscribers.length === 0) {
    // No matching subscribers: mark campaign as failed / completed with 0 recipients
    await repository.updateCampaign(db, tenantId, campaignId, {
      status: 'sent',
      sentAt: new Date()
    });
    return { recipientsEnqueued: 0 };
  }

  // 3. Process and batch insert recipients and outbox items in a transaction
  await db.transaction(async (tx) => {
    const recipientsToInsert = subscribers.map(sub => ({
      tenantId,
      campaignId,
      subscriberId: sub.id,
      status: 'pending' as const
    }));

    const insertedRecipients = await repository.createRecipients(tx as any, recipientsToInsert);

    const outboxItemsToInsert = insertedRecipients.map(recipient => {
      const sub = subscribers.find(s => s.id === recipient.subscriberId)!;
      
      // Personalise template
      const context = {
        subscriber: {
          firstName: sub.firstName || '',
          lastName: sub.lastName || '',
          email: sub.email
        },
        tenant: tenantContext
      };

      const personalisedSubject = renderTemplate(campaign.subject, context);
      const personalisedHtml = renderTemplate(template.htmlContent, context);
      const personalisedText = template.textContent 
        ? renderTemplate(template.textContent, context) 
        : undefined;

      return {
        tenantId,
        campaignId,
        recipientId: recipient.id,
        operation: 'campaign_send' as const,
        status: 'pending' as const,
        payloadJson: {
          to: [{ email: sub.email, name: `${sub.firstName || ''} ${sub.lastName || ''}`.trim() }],
          subject: personalisedSubject,
          htmlContent: personalisedHtml,
          textContent: personalisedText
        },
        dedupeKey: `campaign:${campaignId}:recipient:${recipient.id}`,
        correlationId: `campaign:${campaignId}`
      };
    });

    await repository.enqueueOutboxItems(tx as any, outboxItemsToInsert);

    // 4. Update campaign status to sent
    await tx
      .update(emailCampaigns)
      .set({
        status: 'sent',
        sentAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(emailCampaigns.id, campaignId));

    // Audit Log
    await tx.insert(auditLogs).values({
      eventType: 'campaign_sent',
      actorType: 'user',
      actorUserId: userId,
      entityType: 'email_campaigns',
      entityId: campaignId,
      correlationId: `campaign_sent_${campaignId}`,
      metadata: { recipientCount: subscribers.length }
    });
  });

  return { recipientsEnqueued: subscribers.length };
}

// ==========================================
// WEBHOOKS PROCESSING
// ==========================================
export async function processBrevoWebhook(payload: Record<string, unknown>) {
  const event = normalizeBrevoWebhookEvent(payload);

  // Extract messageId from Brevo payload
  const providerMessageId = (payload['message-id'] || payload['messageId'] || payload['msgid'] || payload['message_id']) as string | undefined;
  if (!providerMessageId) {
    console.log('[Webhook] Webhook payload missing message identifier. Ignoring.', payload);
    return { success: false, reason: 'missing_message_id' };
  }

  // 1. Locate the recipient in the campaign database by checking the campaign log
  let recipient = await repository.updateRecipientStatusByProviderId(
    db, 
    providerMessageId, 
    mapRecipientStatus(event.eventType), 
    getTimestampField(event.eventType)
  ).then(rows => rows[0]);

  const isUuid = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  if (!recipient && event.campaignId && isUuid(event.campaignId) && event.email) {
    recipient = await repository.findRecipientByCampaignAndEmail(db, event.campaignId, event.email) as any;
  }

  if (!recipient) {
    console.log(`[Webhook] No active recipient matching Brevo messageId ${providerMessageId}. Logging event anyway.`);
  }

  // 2. Log event in email_events
  await repository.recordEmailEvent(db, {
    tenantId: recipient?.tenantId || event.metadata.tenantId as string || '00000000-0000-0000-0000-000000000000',
    campaignId: recipient?.campaignId || null,
    recipientId: recipient?.id || null,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    metadata: event.metadata
  });

  // 3. Handle suppressions & unsubscribe logic
  if (event.eventType === 'unsubscribe' || event.eventType === 'bounce' || event.eventType === 'complaint') {
    const email = event.email || event.recipientEmail;
    if (email && recipient) {
      const reasonMap = {
        unsubscribe: 'unsubscribe' as const,
        bounce: 'bounce' as const,
        complaint: 'complaint' as const
      };

      // Add to suppressions
      await repository.addSuppression(db, {
        tenantId: recipient.tenantId,
        subscriberId: recipient.subscriberId,
        campaignId: recipient.campaignId,
        email,
        reason: reasonMap[event.eventType as 'unsubscribe' | 'bounce' | 'complaint'] || 'manual',
        source: 'webhook_sync',
        metadata: event.metadata
      });

      // Update subscriber status
      const statusMap = {
        unsubscribe: 'unsubscribed' as const,
        bounce: 'bounced' as const,
        complaint: 'suppressed' as const
      };

      await repository.updateSubscriber(db, recipient.tenantId, recipient.subscriberId, {
        status: statusMap[event.eventType as 'unsubscribe' | 'bounce' | 'complaint'] || 'suppressed',
        unsubscribedAt: event.eventType === 'unsubscribe' ? new Date() : undefined
      });
    }
  }

  return { success: true };
}

function mapRecipientStatus(eventType: string) {
  switch (eventType) {
    case 'sent': return 'sent' as const;
    case 'delivered': return 'delivered' as const;
    case 'opened': return 'opened' as const;
    case 'clicked': return 'clicked' as const;
    case 'bounce': return 'bounced' as const;
    case 'complaint':
    case 'unsubscribe':
    default:
      return 'failed' as const;
  }
}

function getTimestampField(eventType: string) {
  switch (eventType) {
    case 'delivered': return 'deliveredAt' as const;
    case 'opened': return 'openedAt' as const;
    case 'clicked': return 'clickedAt' as const;
    case 'bounce':
    default:
      return 'bouncedAt' as const;
  }
}
