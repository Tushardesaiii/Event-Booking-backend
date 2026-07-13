import { and, eq, sql, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { emailTemplates } from '../../db/schema/email-templates.js';
import { emailPreferences } from '../../db/schema/email-preferences.js';
import { emailSuppressions } from '../../db/schema/email-suppressions.js';
import { emailCampaigns } from '../../db/schema/email-campaigns.js';
import { emailCampaignRecipients } from '../../db/schema/email-campaign-recipients.js';
import { emailDeliveries } from '../../db/schema/email-deliveries.js';
import { emailEvents } from '../../db/schema/email-events.js';
import { emailBounces } from '../../db/schema/email-bounces.js';
import { emailComplaints } from '../../db/schema/email-complaints.js';
import { emailAuditLogs } from '../../db/schema/email-audit-logs.js';
import { randomUUID } from 'node:crypto';

export class EmailsRepository {
  // --- TEMPLATES ---

  async createTemplate(tx: any, tenantId: string, data: { name: string; subject: string; htmlContent: string; textContent?: string }) {
    const [template] = await tx
      .insert(emailTemplates)
      .values({
        tenantId,
        name: data.name,
        subject: data.subject,
        htmlContent: data.htmlContent,
        textContent: data.textContent || null,
        isActive: true
      })
      .returning();
    return template;
  }

  async findTemplateById(tx: any, tenantId: string, id: string) {
    const [template] = await tx
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.id, id)))
      .limit(1);
    return template;
  }

  async updateTemplate(tx: any, tenantId: string, id: string, data: Partial<{ name: string; subject: string; htmlContent: string; textContent: string | null; isActive: boolean }>) {
    const [template] = await tx
      .update(emailTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.id, id)))
      .returning();
    return template;
  }

  async deleteTemplate(tx: any, tenantId: string, id: string) {
    const [template] = await tx
      .update(emailTemplates)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.id, id)))
      .returning();
    return template;
  }

  async listTemplates(tx: any, tenantId: string) {
    return tx
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.tenantId, tenantId), sql`deleted_at is null`));
  }

  // --- PREFERENCES ---

  async findPreferencesByEmail(tx: any, tenantId: string, email: string) {
    const [prefs] = await tx
      .select()
      .from(emailPreferences)
      .where(and(eq(emailPreferences.tenantId, tenantId), eq(emailPreferences.email, email.trim().toLowerCase())))
      .limit(1);
    return prefs;
  }

  async findPreferencesByToken(tx: any, token: string) {
    const [prefs] = await tx
      .select()
      .from(emailPreferences)
      .where(eq(emailPreferences.unsubscribeToken, token))
      .limit(1);
    return prefs;
  }

  async upsertPreferences(
    tx: any,
    tenantId: string,
    email: string,
    data: { userId?: string | null; marketing?: boolean; campaign?: boolean; notification?: boolean }
  ) {
    const existing = await this.findPreferencesByEmail(tx, tenantId, email);

    if (existing) {
      const [updated] = await tx
        .update(emailPreferences)
        .set({
          ...data,
          updatedAt: new Date()
        })
        .where(eq(emailPreferences.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await tx
      .insert(emailPreferences)
      .values({
        tenantId,
        userId: data.userId || null,
        email: email.trim().toLowerCase(),
        marketing: data.marketing !== false,
        campaign: data.campaign !== false,
        notification: data.notification !== false,
        unsubscribeToken: randomUUID()
      })
      .returning();
    return created;
  }

  // --- SUPPRESSIONS ---

  async isSuppressed(tx: any, tenantId: string, email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const domain = normalized.split('@')[1];

    const conditions = [
      and(
        eq(emailSuppressions.tenantId, tenantId),
        eq(emailSuppressions.email, normalized),
        eq(emailSuppressions.scope, 'individual')
      )
    ];

    if (domain) {
      conditions.push(
        and(
          eq(emailSuppressions.tenantId, tenantId),
          eq(emailSuppressions.email, domain),
          eq(emailSuppressions.scope, 'domain')
        )
      );
    }

    const rows = await tx
      .select()
      .from(emailSuppressions)
      .where(or(...conditions))
      .limit(1);

    return rows.length > 0;
  }

  async addSuppression(tx: any, data: { tenantId: string; email: string; reason: string; scope?: string; source?: string; metadata?: any }) {
    // Avoid double suppression insertion for same email
    const emailNorm = data.email.trim().toLowerCase();
    const [existing] = await tx
      .select()
      .from(emailSuppressions)
      .where(and(eq(emailSuppressions.tenantId, data.tenantId), eq(emailSuppressions.email, emailNorm)))
      .limit(1);

    if (existing) return existing;

    const [created] = await tx
      .insert(emailSuppressions)
      .values({
        tenantId: data.tenantId,
        email: emailNorm,
        reason: data.reason,
        scope: data.scope || 'individual',
        source: data.source || 'system',
        metadata: data.metadata || {}
      })
      .returning();
    return created;
  }

  // --- BOUNCES & COMPLAINTS ---

  async recordBounce(tx: any, data: { tenantId: string; email: string; bounceType: string; bounceSubType?: string; description?: string; providerMessageId?: string; metadata?: any }) {
    return tx.insert(emailBounces).values(data).returning();
  }

  async recordComplaint(tx: any, data: { tenantId: string; email: string; complaintType?: string; userAgent?: string; providerMessageId?: string; metadata?: any }) {
    return tx.insert(emailComplaints).values(data).returning();
  }

  // --- AUDIT LOGS ---

  async recordAudit(tx: any, data: { tenantId: string; userId?: string | null; action: string; email: string; metadata?: any }) {
    return tx.insert(emailAuditLogs).values(data).returning();
  }

  // --- CAMPAIGNS ---

  async createCampaign(tx: any, tenantId: string, createdByUserId: string, data: { name: string; subject: string; templateId?: string | null; segmentId?: string | null; audienceFiltersJson?: any }) {
    const [campaign] = await tx
      .insert(emailCampaigns)
      .values({
        tenantId,
        createdByUserId,
        name: data.name,
        subject: data.subject,
        templateId: data.templateId || null,
        segmentId: data.segmentId || null,
        audienceFiltersJson: data.audienceFiltersJson || {},
        status: 'draft'
      })
      .returning();
    return campaign;
  }

  async findCampaignById(tx: any, tenantId: string, id: string) {
    const [campaign] = await tx
      .select()
      .from(emailCampaigns)
      .where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.id, id)))
      .limit(1);
    return campaign;
  }

  async updateCampaign(tx: any, tenantId: string, id: string, data: any) {
    const [campaign] = await tx
      .update(emailCampaigns)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.id, id)))
      .returning();
    return campaign;
  }

  async listCampaigns(tx: any, tenantId: string) {
    return tx
      .select()
      .from(emailCampaigns)
      .where(eq(emailCampaigns.tenantId, tenantId));
  }

  async createCampaignRecipientsSnapshot(tx: any, recipients: { tenantId: string; campaignId: string; subscriberId: string; status: 'pending' }[]) {
    if (recipients.length === 0) return [];
    return tx.insert(emailCampaignRecipients).values(recipients).returning();
  }

  async updateCampaignRecipientStatus(tx: any, campaignId: string, subscriberId: string, status: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed') {
    return tx
      .update(emailCampaignRecipients)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.subscriberId, subscriberId)))
      .returning();
  }

  // --- EVENT TRACKING ---

  async findEventByProviderId(tx: any, providerEventId: string) {
    const [evt] = await tx
      .select()
      .from(emailEvents)
      .where(eq(emailEvents.providerEventId, providerEventId))
      .limit(1);
    return evt;
  }

  async recordEmailEvent(tx: any, data: { tenantId: string; campaignId?: string | null; recipientId?: string | null; providerEventId: string; eventType: any; metadata?: any }) {
    return tx.insert(emailEvents).values(data).returning();
  }
}

export const emailsRepository = new EmailsRepository();
