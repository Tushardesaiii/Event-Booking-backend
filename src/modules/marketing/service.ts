import { db } from '../../db/client.js';
import { forbidden, notFound, badRequest } from '../../lib/errors.js';
import { parsePagination, buildPaginationMeta } from '../../lib/pagination.js';
import {
  upsertSubscriberRecord,
  unsubscribeSubscriberRecord,
  findSubscriberById,
  findSubscriberByEmail,
  updateSubscriberRecord,
  softDeleteSubscriberRecord,
  listSubscribersForCriteria
} from './repository.js';
import { insertVerificationEvent } from '../notifications/repository.js';
import { users } from '../../db/schema/users.js';
import { tenants } from '../../db/schema/tenants.js';
import { tenantMembers } from '../../db/schema/tenant-members.js';
import { and, eq, or } from 'drizzle-orm';
import type { SubscribeInput, UnsubscribeInput, UpdateSubscriberInput, ListSubscribersQueryInput } from './validation.js';

export async function checkIsPlatformAdmin(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ username: users.username, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user && (user.isPlatformAdmin || user.username === 'admin')) {
    return true;
  }

  // Also check if member of a tenant with slug 'platform' or 'system' with role owner/admin
  const specialTenants = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(or(eq(tenants.slug, 'platform'), eq(tenants.slug, 'system')));

  if (specialTenants.length > 0) {
    const memberships = await db
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.userId, userId),
          or(...specialTenants.map((t) => eq(tenantMembers.tenantId, t.id)))
        )
      );

    const hasPrivilege = memberships.some((m) => m.role === 'owner' || m.role === 'admin');
    if (hasPrivilege) {
      return true;
    }
  }

  return false;
}

export class MarketingSubscriberService {
  async subscribe(input: SubscribeInput, tenantId?: string | null) {
    const subscriber = await db.transaction(async (tx) => {
      const sub = await upsertSubscriberRecord(tx, {
        tenantId: tenantId ?? null,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        source: input.source,
        metadata: input.metadata
      });

      await insertVerificationEvent(tx, {
        eventType: 'subscriber_added',
        source: 'marketing',
        email: input.email,
        tenantId: tenantId ?? null,
        metadata: { source: input.source }
      });

      return sub;
    });

    return subscriber;
  }

  async unsubscribe(input: UnsubscribeInput, tenantId?: string | null) {
    const subscriber = await db.transaction(async (tx) => {
      const sub = await unsubscribeSubscriberRecord(tx, input.email);

      await insertVerificationEvent(tx, {
        eventType: 'subscriber_removed',
        source: 'marketing',
        email: input.email,
        tenantId: tenantId ?? null
      });

      return sub;
    });

    if (!subscriber) {
      throw notFound('Subscriber not found or already unsubscribed');
    }

    return subscriber;
  }

  async updateSubscriber(id: string, input: UpdateSubscriberInput, tenantId?: string | null) {
    const existing = await findSubscriberById(db, id);
    if (!existing) {
      throw notFound('Subscriber not found');
    }

    if (tenantId && existing.tenantId !== tenantId) {
      throw forbidden('You do not have access to this subscriber');
    }

    const updated = await updateSubscriberRecord(db, id, input);
    return updated;
  }

  async deleteSubscriber(id: string, tenantId?: string | null) {
    const existing = await findSubscriberById(db, id);
    if (!existing) {
      throw notFound('Subscriber not found');
    }

    if (tenantId && existing.tenantId !== tenantId) {
      throw forbidden('You do not have access to this subscriber');
    }

    const deleted = await softDeleteSubscriberRecord(db, id);
    return deleted;
  }

  async listSubscribers(criteria: ListSubscribersQueryInput, currentUserId: string, tenantId?: string | null) {
    const pagination = parsePagination(criteria);
    let targetTenantId: string | null = tenantId ?? null;

    if (!tenantId) {
      // Global list requested
      const isAdmin = await checkIsPlatformAdmin(currentUserId);
      if (!isAdmin) {
        throw forbidden('Insufficient permissions to list subscribers globally');
      }
      // If platform admin passed a tenantId query param, filter by it
      if (criteria.tenantId) {
        targetTenantId = criteria.tenantId;
      }
    }

    const { rows, total } = await listSubscribersForCriteria(
      db,
      {
        tenantId: targetTenantId,
        search: criteria.search
      },
      pagination
    );

    return {
      items: rows,
      meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
    };
  }
}

export const marketingSubscriberService = new MarketingSubscriberService();
