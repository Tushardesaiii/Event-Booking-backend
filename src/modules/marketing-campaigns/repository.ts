import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { marketingCampaigns } from '../../db/schema/marketing-campaigns.js';
import { marketingCampaignDeliveries } from '../../db/schema/marketing-campaign-deliveries.js';
import { marketingSubscribers } from '../../db/schema/marketing-subscribers.js';

type CampaignDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

export async function createCampaignRecord(
  database: CampaignDatabase,
  input: {
    tenantId: string;
    name: string;
    subject: string;
    templateType: string;
    status: string;
    createdBy: string;
    metadata?: Record<string, any> | null;
  }
) {
  const [campaign] = await database
    .insert(marketingCampaigns)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      subject: input.subject,
      templateType: input.templateType,
      status: input.status,
      createdBy: input.createdBy,
      metadata: input.metadata ?? {}
    })
    .returning();

  return campaign ?? null;
}

export async function findCampaignById(
  database: CampaignDatabase,
  id: string,
  tenantId: string
) {
  const [campaign] = await database
    .select()
    .from(marketingCampaigns)
    .where(
      and(
        eq(marketingCampaigns.id, id),
        eq(marketingCampaigns.tenantId, tenantId)
      )
    )
    .limit(1);

  return campaign ?? null;
}

export async function updateCampaignRecord(
  database: CampaignDatabase,
  id: string,
  tenantId: string,
  input: {
    name?: string;
    subject?: string;
    templateType?: string;
    status?: string;
    scheduledAt?: Date | null;
    sentAt?: Date | null;
    metadata?: Record<string, any> | null;
  }
) {
  const [campaign] = await database
    .update(marketingCampaigns)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.templateType === undefined ? {} : { templateType: input.templateType }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
      ...(input.sentAt === undefined ? {} : { sentAt: input.sentAt }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(marketingCampaigns.id, id),
        eq(marketingCampaigns.tenantId, tenantId)
      )
    )
    .returning();

  return campaign ?? null;
}

export async function listCampaignsForTenant(
  database: CampaignDatabase,
  tenantId: string,
  criteria: {
    status?: string | null;
  },
  pagination: { limit: number; offset: number }
) {
  const conditions = [eq(marketingCampaigns.tenantId, tenantId)];

  if (criteria.status) {
    conditions.push(eq(marketingCampaigns.status, criteria.status));
  }

  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(marketingCampaigns)
    .where(whereClause);

  const rows = await database
    .select()
    .from(marketingCampaigns)
    .where(whereClause)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.count ?? 0)
  };
}

export async function getCampaignSubscribers(
  database: CampaignDatabase,
  tenantId: string
) {
  return database
    .select()
    .from(marketingSubscribers)
    .where(
      and(
        eq(marketingSubscribers.tenantId, tenantId),
        isNull(marketingSubscribers.unsubscribedAt),
        isNull(marketingSubscribers.deletedAt)
      )
    );
}

export async function createDeliveryRecords(
  database: CampaignDatabase,
  deliveries: Array<{
    campaignId: string;
    subscriberId: string;
    email: string;
    deliveryStatus: string;
    providerMessageId?: string | null;
    metadata?: Record<string, any> | null;
  }>
) {
  if (deliveries.length === 0) return [];
  return database.insert(marketingCampaignDeliveries).values(deliveries).returning();
}

export async function getCampaignAnalyticsData(
  database: CampaignDatabase,
  campaignId: string
) {
  const counts = await database
    .select({
      status: marketingCampaignDeliveries.deliveryStatus,
      count: sql<number>`count(*)::int`
    })
    .from(marketingCampaignDeliveries)
    .where(eq(marketingCampaignDeliveries.campaignId, campaignId))
    .groupBy(marketingCampaignDeliveries.deliveryStatus);

  const result = {
    total: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
    unsubscribed: 0
  };

  for (const row of counts) {
    result.total += row.count;
    if (row.status === 'sent') result.sent += row.count;
    else if (row.status === 'delivered') result.delivered += row.count;
    else if (row.status === 'opened') result.opened += row.count;
    else if (row.status === 'clicked') result.clicked += row.count;
    else if (row.status === 'bounced') result.bounced += row.count;
    else if (row.status === 'failed') result.failed += row.count;
    else if (row.status === 'unsubscribed') result.unsubscribed += row.count;
  }

  return result;
}
