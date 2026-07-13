import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { emailTemplates } from '../../db/schema/email-templates.js';
import { emailCampaigns } from '../../db/schema/email-campaigns.js';
import { emailSegments } from '../../db/schema/email-segments.js';
import { emailSubscribers } from '../../db/schema/email-subscribers.js';
import { emailCampaignRecipients } from '../../db/schema/email-campaign-recipients.js';
import { emailOutbox } from '../../db/schema/email-outbox.js';
import { emailEvents } from '../../db/schema/email-events.js';
import { emailSuppressions } from '../../db/schema/email-suppressions.js';

// ==========================================
// TEMPLATES
// ==========================================
export async function findTemplateById(database: typeof db, tenantId: string, id: string) {
  const [template] = await database
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
    .limit(1);
  return template ?? null;
}

export async function createTemplate(database: typeof db, tenantId: string, input: { name: string; subject: string; htmlContent: string; textContent?: string }) {
  const [template] = await database
    .insert(emailTemplates)
    .values({
      tenantId,
      name: input.name,
      subject: input.subject,
      htmlContent: input.htmlContent,
      textContent: input.textContent ?? null
    })
    .returning();
  return template;
}

export async function updateTemplate(database: typeof db, tenantId: string, id: string, input: Partial<{ name: string; subject: string; htmlContent: string; textContent: string | null; isActive: boolean }>) {
  const [template] = await database
    .update(emailTemplates)
    .set({
      ...input,
      updatedAt: new Date()
    })
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
    .returning();
  return template ?? null;
}

export async function deleteTemplate(database: typeof db, tenantId: string, id: string) {
  const [template] = await database
    .update(emailTemplates)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
    .returning();
  return template ?? null;
}

export async function listTemplates(database: typeof db, tenantId: string) {
  return database
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), isNull(emailTemplates.deletedAt)));
}

// ==========================================
// SUBSCRIBERS
// ==========================================
export async function findSubscriberById(database: typeof db, tenantId: string, id: string) {
  const [subscriber] = await database
    .select()
    .from(emailSubscribers)
    .where(and(eq(emailSubscribers.tenantId, tenantId), eq(emailSubscribers.id, id)))
    .limit(1);
  return subscriber ?? null;
}

export async function findSubscriberByEmail(database: typeof db, tenantId: string, email: string) {
  const [subscriber] = await database
    .select()
    .from(emailSubscribers)
    .where(and(eq(emailSubscribers.tenantId, tenantId), eq(emailSubscribers.email, email.toLowerCase())))
    .limit(1);
  return subscriber ?? null;
}

export async function createSubscriber(database: typeof db, tenantId: string, input: { email: string; firstName?: string; lastName?: string; status?: 'subscribed' | 'unsubscribed' | 'suppressed' | 'bounced'; source?: string; userId?: string }) {
  const [subscriber] = await database
    .insert(emailSubscribers)
    .values({
      tenantId,
      email: input.email.toLowerCase(),
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      status: input.status ?? 'subscribed',
      source: input.source ?? 'manual',
      userId: input.userId ?? null
    })
    .returning();
  return subscriber;
}

export async function updateSubscriber(database: typeof db, tenantId: string, id: string, input: Partial<{ firstName: string | null; lastName: string | null; status: 'subscribed' | 'unsubscribed' | 'suppressed' | 'bounced'; unsubscribedAt: Date | null }>) {
  const [subscriber] = await database
    .update(emailSubscribers)
    .set({
      ...input,
      updatedAt: new Date()
    })
    .where(and(eq(emailSubscribers.tenantId, tenantId), eq(emailSubscribers.id, id)))
    .returning();
  return subscriber ?? null;
}

export async function batchUpsertSubscribers(
  database: typeof db,
  tenantId: string,
  subscribersList: { email: string; firstName?: string | null; lastName?: string | null; source: string }[]
) {
  if (subscribersList.length === 0) return [];
  
  return database
    .insert(emailSubscribers)
    .values(subscribersList.map(s => ({
      tenantId,
      email: s.email.toLowerCase(),
      firstName: s.firstName ?? null,
      lastName: s.lastName ?? null,
      source: s.source,
      status: 'subscribed' as const
    })))
    .onConflictDoUpdate({
      target: [emailSubscribers.tenantId, emailSubscribers.email],
      set: {
        firstName: sql`EXCLUDED.first_name`,
        lastName: sql`EXCLUDED.last_name`,
        source: sql`EXCLUDED.source`,
        status: 'subscribed', // Reset to subscribed if uploaded again
        updatedAt: new Date()
      }
    })
    .returning();
}

export async function listSubscribers(database: typeof db, tenantId: string) {
  return database
    .select()
    .from(emailSubscribers)
    .where(eq(emailSubscribers.tenantId, tenantId));
}

// ==========================================
// SEGMENTS
// ==========================================
export async function findSegmentById(database: typeof db, tenantId: string, id: string) {
  const [segment] = await database
    .select()
    .from(emailSegments)
    .where(and(eq(emailSegments.tenantId, tenantId), eq(emailSegments.id, id)))
    .limit(1);
  return segment ?? null;
}

export async function createSegment(database: typeof db, tenantId: string, input: { name: string; description?: string; filters: Record<string, any> }) {
  const [segment] = await database
    .insert(emailSegments)
    .values({
      tenantId,
      name: input.name,
      description: input.description ?? null,
      filtersJson: input.filters
    })
    .returning();
  return segment;
}

export async function updateSegment(database: typeof db, tenantId: string, id: string, input: Partial<{ name: string; description: string | null; filtersJson: Record<string, any> }>) {
  const [segment] = await database
    .update(emailSegments)
    .set({
      ...input,
      updatedAt: new Date()
    })
    .where(and(eq(emailSegments.tenantId, tenantId), eq(emailSegments.id, id)))
    .returning();
  return segment ?? null;
}

export async function deleteSegment(database: typeof db, tenantId: string, id: string) {
  const [segment] = await database
    .delete(emailSegments)
    .where(and(eq(emailSegments.tenantId, tenantId), eq(emailSegments.id, id)))
    .returning();
  return segment ?? null;
}

export async function listSegments(database: typeof db, tenantId: string) {
  return database
    .select()
    .from(emailSegments)
    .where(eq(emailSegments.tenantId, tenantId));
}

// ==========================================
// CAMPAIGNS
// ==========================================
export async function findCampaignById(database: typeof db, tenantId: string, id: string) {
  const [campaign] = await database
    .select()
    .from(emailCampaigns)
    .where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.id, id), isNull(emailCampaigns.deletedAt)))
    .limit(1);
  return campaign ?? null;
}

export async function createCampaign(database: typeof db, tenantId: string, input: { name: string; subject: string; templateId?: string | null; segmentId?: string | null; audienceFiltersJson?: Record<string, any> | null; createdByUserId: string }) {
  const [campaign] = await database
    .insert(emailCampaigns)
    .values({
      tenantId,
      name: input.name,
      subject: input.subject,
      templateId: input.templateId ?? null,
      segmentId: input.segmentId ?? null,
      audienceFiltersJson: input.audienceFiltersJson ?? {},
      createdByUserId: input.createdByUserId,
      status: 'draft'
    })
    .returning();
  return campaign;
}

export async function updateCampaign(database: typeof db, tenantId: string, id: string, input: Partial<{ name: string; subject: string; templateId: string | null; segmentId: string | null; status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'; scheduledAt: Date | null; sentAt: Date | null; audienceFiltersJson: Record<string, any> | null }>) {
  const [campaign] = await database
    .update(emailCampaigns)
    .set({
      ...input,
      updatedAt: new Date()
    })
    .where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.id, id), isNull(emailCampaigns.deletedAt)))
    .returning();
  return campaign ?? null;
}

export async function deleteCampaign(database: typeof db, tenantId: string, id: string) {
  const [campaign] = await database
    .update(emailCampaigns)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.id, id), isNull(emailCampaigns.deletedAt)))
    .returning();
  return campaign ?? null;
}

export async function listCampaigns(database: typeof db, tenantId: string) {
  return database
    .select()
    .from(emailCampaigns)
    .where(and(eq(emailCampaigns.tenantId, tenantId), isNull(emailCampaigns.deletedAt)));
}

// ==========================================
// RECIPIENTS & OUTBOX
// ==========================================
export async function createRecipients(
  database: typeof db,
  recipientsList: { tenantId: string; campaignId: string; subscriberId: string; status: 'pending' | 'sent' | 'failed' }[]
) {
  if (recipientsList.length === 0) return [];
  
  return database
    .insert(emailCampaignRecipients)
    .values(recipientsList)
    .returning();
}

export async function enqueueOutboxItems(
  database: typeof db,
  itemsList: { tenantId: string; campaignId?: string | null; recipientId?: string | null; operation: 'campaign_send' | 'single_send'; status: 'pending'; payloadJson: Record<string, any>; dedupeKey: string; correlationId: string; maxRetries?: number }[]
) {
  if (itemsList.length === 0) return [];

  return database
    .insert(emailOutbox)
    .values(itemsList)
    .onConflictDoNothing() // Prevent double-inserting if dedupeKey collides
    .returning();
}

// ==========================================
// WEBHOOKS / EVENTS & SUPPRESSIONS
// ==========================================
export async function recordEmailEvent(
  database: typeof db,
  event: { tenantId: string; campaignId?: string | null; recipientId?: string | null; providerEventId: string; eventType: 'sent' | 'delivered' | 'opened' | 'clicked' | 'unsubscribe' | 'bounce' | 'complaint'; metadata: Record<string, any> }
) {
  return database
    .insert(emailEvents)
    .values(event)
    .onConflictDoNothing() // Ensure idempotency for webhook delivery retries
    .returning();
}

export async function updateRecipientStatusByProviderId(
  database: typeof db,
  providerMessageId: string,
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed',
  timestampField: 'deliveredAt' | 'openedAt' | 'clickedAt' | 'bouncedAt'
) {
  return database
    .update(emailCampaignRecipients)
    .set({
      status,
      [timestampField]: new Date(),
      updatedAt: new Date()
    })
    .where(eq(emailCampaignRecipients.providerMessageId, providerMessageId))
    .returning();
}

export async function findRecipientByCampaignAndEmail(database: typeof db, campaignId: string, email: string) {
  const [recipient] = await database
    .select({
      id: emailCampaignRecipients.id,
      tenantId: emailCampaignRecipients.tenantId,
      campaignId: emailCampaignRecipients.campaignId,
      subscriberId: emailCampaignRecipients.subscriberId
    })
    .from(emailCampaignRecipients)
    .innerJoin(emailSubscribers, eq(emailCampaignRecipients.subscriberId, emailSubscribers.id))
    .where(and(
      eq(emailCampaignRecipients.campaignId, campaignId),
      eq(emailSubscribers.email, email.toLowerCase())
    ))
    .limit(1);
  return recipient ?? null;
}

export async function addSuppression(
  database: typeof db,
  suppression: { tenantId: string; subscriberId?: string | null; campaignId?: string | null; email: string; reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual'; source?: string; metadata?: Record<string, any> }
) {
  return database
    .insert(emailSuppressions)
    .values({
      tenantId: suppression.tenantId,
      subscriberId: suppression.subscriberId ?? null,
      campaignId: suppression.campaignId ?? null,
      email: suppression.email.toLowerCase(),
      reason: suppression.reason,
      source: suppression.source ?? 'system',
      metadata: suppression.metadata ?? {}
    })
    .onConflictDoNothing()
    .returning();
}
