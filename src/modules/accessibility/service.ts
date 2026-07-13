import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { accessibilityRequests, accessibilityZones } from './schema.js';

// ---- Zones ----------------------------------------------------------------

export async function listZones(tenantId: string, eventId?: string) {
  const conditions = [eq(accessibilityZones.tenantId, tenantId), isNull(accessibilityZones.deletedAt)];
  if (eventId) conditions.push(eq(accessibilityZones.eventId, eventId));
  return db.select().from(accessibilityZones).where(and(...conditions)).orderBy(desc(accessibilityZones.createdAt));
}

export async function createZone(
  tenantId: string,
  input: { eventId: string; name: string; gate?: string | null; total?: number; used?: number }
) {
  const [row] = await db
    .insert(accessibilityZones)
    .values({
      tenantId,
      eventId: input.eventId,
      name: input.name,
      gate: input.gate ?? null,
      total: input.total ?? 0,
      used: input.used ?? 0
    })
    .returning();
  return row;
}

export async function updateZone(
  tenantId: string,
  id: string,
  input: Partial<{ name: string; gate: string | null; total: number; used: number }>
) {
  const [row] = await db
    .update(accessibilityZones)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(accessibilityZones.tenantId, tenantId), eq(accessibilityZones.id, id), isNull(accessibilityZones.deletedAt)))
    .returning();
  if (!row) throw notFound('Accessibility zone not found');
  return row;
}

export async function deleteZone(tenantId: string, id: string) {
  const [row] = await db
    .update(accessibilityZones)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(accessibilityZones.tenantId, tenantId), eq(accessibilityZones.id, id), isNull(accessibilityZones.deletedAt)))
    .returning();
  if (!row) throw notFound('Accessibility zone not found');
  return row;
}

// ---- Requests -------------------------------------------------------------

export async function listRequests(tenantId: string, filters: { eventId?: string; status?: string }) {
  const conditions = [eq(accessibilityRequests.tenantId, tenantId), isNull(accessibilityRequests.deletedAt)];
  if (filters.eventId) conditions.push(eq(accessibilityRequests.eventId, filters.eventId));
  if (filters.status) conditions.push(eq(accessibilityRequests.status, filters.status));
  return db.select().from(accessibilityRequests).where(and(...conditions)).orderBy(desc(accessibilityRequests.createdAt));
}

export async function createRequest(
  tenantId: string,
  actorUserId: string,
  input: { eventId: string; attendeeName: string; need: string; gate?: string | null; contact?: string | null; status?: string; notes?: string | null }
) {
  const [row] = await db
    .insert(accessibilityRequests)
    .values({
      tenantId,
      eventId: input.eventId,
      attendeeName: input.attendeeName,
      need: input.need,
      gate: input.gate ?? null,
      contact: input.contact ?? null,
      status: input.status ?? 'pending',
      notes: input.notes ?? null,
      createdByUserId: actorUserId
    })
    .returning();
  return row;
}

export async function updateRequest(
  tenantId: string,
  id: string,
  input: Partial<{ status: string; gate: string | null; need: string; attendeeName: string; contact: string | null; notes: string | null }>
) {
  const [row] = await db
    .update(accessibilityRequests)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(accessibilityRequests.tenantId, tenantId), eq(accessibilityRequests.id, id), isNull(accessibilityRequests.deletedAt)))
    .returning();
  if (!row) throw notFound('Accessibility request not found');
  return row;
}

export async function deleteRequest(tenantId: string, id: string) {
  const [row] = await db
    .update(accessibilityRequests)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(accessibilityRequests.tenantId, tenantId), eq(accessibilityRequests.id, id), isNull(accessibilityRequests.deletedAt)))
    .returning();
  if (!row) throw notFound('Accessibility request not found');
  return row;
}
