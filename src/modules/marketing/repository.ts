import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { marketingSubscribers } from '../../db/schema/marketing-subscribers.js';

type MarketingDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

export async function upsertSubscriberRecord(
  database: MarketingDatabase,
  input: {
    tenantId: string | null;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    source: string;
    metadata?: Record<string, any> | null;
  }
) {
  const [subscriber] = await database
    .insert(marketingSubscribers)
    .values({
      tenantId: input.tenantId ?? null,
      email: input.email.trim().toLowerCase(),
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      source: input.source,
      metadata: input.metadata ?? {},
      subscribedAt: new Date(),
      unsubscribedAt: null,
      deletedAt: null
    })
    .onConflictDoUpdate({
      target: marketingSubscribers.email,
      set: {
        tenantId: input.tenantId ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        source: input.source,
        metadata: input.metadata ?? {},
        unsubscribedAt: null,
        deletedAt: null,
        updatedAt: new Date()
      }
    })
    .returning();

  return subscriber ?? null;
}

export async function unsubscribeSubscriberRecord(
  database: MarketingDatabase,
  email: string
) {
  const [subscriber] = await database
    .update(marketingSubscribers)
    .set({
      unsubscribedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(marketingSubscribers.email, email.trim().toLowerCase()),
        isNull(marketingSubscribers.deletedAt)
      )
    )
    .returning();

  return subscriber ?? null;
}

export async function findSubscriberById(database: MarketingDatabase, id: string) {
  const [subscriber] = await database
    .select()
    .from(marketingSubscribers)
    .where(
      and(
        eq(marketingSubscribers.id, id),
        isNull(marketingSubscribers.deletedAt)
      )
    )
    .limit(1);

  return subscriber ?? null;
}

export async function findSubscriberByEmail(database: MarketingDatabase, email: string) {
  const [subscriber] = await database
    .select()
    .from(marketingSubscribers)
    .where(
      and(
        eq(marketingSubscribers.email, email.trim().toLowerCase()),
        isNull(marketingSubscribers.deletedAt)
      )
    )
    .limit(1);

  return subscriber ?? null;
}

export async function updateSubscriberRecord(
  database: MarketingDatabase,
  id: string,
  input: {
    firstName?: string | null;
    lastName?: string | null;
    metadata?: Record<string, any> | null;
  }
) {
  const [subscriber] = await database
    .update(marketingSubscribers)
    .set({
      ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
      ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(marketingSubscribers.id, id),
        isNull(marketingSubscribers.deletedAt)
      )
    )
    .returning();

  return subscriber ?? null;
}

export async function softDeleteSubscriberRecord(database: MarketingDatabase, id: string) {
  const [subscriber] = await database
    .update(marketingSubscribers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(marketingSubscribers.id, id),
        isNull(marketingSubscribers.deletedAt)
      )
    )
    .returning();

  return subscriber ?? null;
}

export async function listSubscribersForCriteria(
  database: MarketingDatabase,
  criteria: {
    tenantId?: string | null;
    search?: string | null;
  },
  pagination: { limit: number; offset: number }
) {
  const conditions = [isNull(marketingSubscribers.deletedAt)];

  if (criteria.tenantId) {
    conditions.push(eq(marketingSubscribers.tenantId, criteria.tenantId));
  }

  if (criteria.search) {
    const searchPattern = `%${criteria.search}%`;
    conditions.push(
      or(
        ilike(marketingSubscribers.email, searchPattern),
        ilike(marketingSubscribers.firstName, searchPattern),
        ilike(marketingSubscribers.lastName, searchPattern)
      ) as any
    );
  }

  const whereClause = and(...conditions);

  const [totalRow] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(marketingSubscribers)
    .where(whereClause);

  const rows = await database
    .select()
    .from(marketingSubscribers)
    .where(whereClause)
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    rows,
    total: Number(totalRow?.count ?? 0)
  };
}
