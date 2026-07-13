import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { events } from '../../db/schema/events.js';
import { ticketTypes } from '../../db/schema/ticket-types.js';
import { settlements } from './schema.js';

const PLATFORM_FEE_RATE = 0.06; // 6% platform fee on gross sales

function addDays(date: Date, days: number) {
  const d = new Date(date.getTime() + days * 86400000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

type SettlementRow = typeof settlements.$inferSelect;

// Join the event title for display (the dashboard table shows it).
async function listWithEventTitle(tenantId: string, filters: { eventId?: string; status?: string }) {
  const conditions = [eq(settlements.tenantId, tenantId), isNull(settlements.deletedAt)];
  if (filters.eventId) conditions.push(eq(settlements.eventId, filters.eventId));
  if (filters.status) conditions.push(eq(settlements.status, filters.status));

  return db
    .select({
      id: settlements.id,
      tenantId: settlements.tenantId,
      eventId: settlements.eventId,
      eventTitle: events.title,
      type: settlements.type,
      grossSales: settlements.grossSales,
      platformFee: settlements.platformFee,
      refunds: settlements.refunds,
      netPayable: settlements.netPayable,
      chequeNo: settlements.chequeNo,
      scheduledDate: settlements.scheduledDate,
      status: settlements.status,
      notes: settlements.notes,
      createdAt: settlements.createdAt,
      updatedAt: settlements.updatedAt
    })
    .from(settlements)
    .leftJoin(events, eq(events.id, settlements.eventId))
    .where(and(...conditions))
    .orderBy(desc(settlements.createdAt));
}

export async function listSettlements(tenantId: string, filters: { eventId?: string; status?: string }) {
  return listWithEventTitle(tenantId, filters);
}

// Gross sales for an event from its ticket types (sold × price), in paise.
async function computeGrossPaise(tenantId: string, eventId: string): Promise<number> {
  const tiers = await db
    .select({ price: ticketTypes.price, sold: ticketTypes.soldQuantity })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.tenantId, tenantId), eq(ticketTypes.eventId, eventId), isNull(ticketTypes.deletedAt)));
  const grossRupees = tiers.reduce((sum, t) => sum + Number(t.price) * (t.sold ?? 0), 0);
  return Math.round(grossRupees * 100);
}

/**
 * Generate the advance + final settlements for an event from real ticket sales.
 * Advance = 50% of net, scheduled ~5 days before the event; final = the balance,
 * scheduled the day after it ends. Idempotent: returns existing if already generated.
 */
export async function generateSettlements(tenantId: string, eventId: string) {
  const [event] = await db
    .select({ id: events.id, startDateTime: events.startDateTime, endDateTime: events.endDateTime })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) throw notFound('Event not found');

  const existing = await db
    .select({ id: settlements.id })
    .from(settlements)
    .where(and(eq(settlements.tenantId, tenantId), eq(settlements.eventId, eventId), isNull(settlements.deletedAt)))
    .limit(1);
  if (existing.length > 0) {
    throw conflict('Settlements already generated for this event');
  }

  const gross = await computeGrossPaise(tenantId, eventId);
  const fee = Math.round(gross * PLATFORM_FEE_RATE);
  const refunds = 0;
  const net = Math.max(0, gross - fee - refunds);
  const advanceNet = Math.round(net * 0.5);
  const finalNet = net - advanceNet;

  const start = event.startDateTime ? new Date(event.startDateTime) : new Date();
  const end = event.endDateTime ? new Date(event.endDateTime) : start;

  const rows = await db
    .insert(settlements)
    .values([
      {
        tenantId,
        eventId,
        type: 'advance',
        grossSales: gross,
        platformFee: fee,
        refunds,
        netPayable: advanceNet,
        scheduledDate: addDays(start, -5),
        status: 'pending'
      },
      {
        tenantId,
        eventId,
        type: 'final',
        grossSales: gross,
        platformFee: fee,
        refunds,
        netPayable: finalNet,
        scheduledDate: addDays(end, 1),
        status: 'pending'
      }
    ])
    .returning();

  return rows;
}

const VALID_STATUSES = ['pending', 'cheque-issued', 'cleared', 'on-hold'] as const;
type SettlementStatus = (typeof VALID_STATUSES)[number];

async function getOwned(tenantId: string, id: string): Promise<SettlementRow> {
  const [row] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.tenantId, tenantId), eq(settlements.id, id), isNull(settlements.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Settlement not found');
  return row;
}

/** Apply a status transition (issue cheque / mark cleared / hold / release). */
export async function updateStatus(
  tenantId: string,
  id: string,
  status: SettlementStatus,
  chequeNo?: string | null
) {
  const current = await getOwned(tenantId, id);

  const patch: Partial<SettlementRow> = { status, updatedAt: new Date() };
  if (status === 'cheque-issued') {
    // Auto-assign a cheque number if none provided.
    patch.chequeNo = chequeNo ?? current.chequeNo ?? `CHQ-${Date.now().toString().slice(-6)}`;
  }
  if (status === 'pending') {
    // Releasing from hold back to pending; keep chequeNo cleared.
    patch.chequeNo = null;
  }

  const [row] = await db
    .update(settlements)
    .set(patch)
    .where(and(eq(settlements.tenantId, tenantId), eq(settlements.id, id), isNull(settlements.deletedAt)))
    .returning();
  if (!row) throw notFound('Settlement not found');
  return row;
}

export async function updateSettlement(
  tenantId: string,
  id: string,
  input: Partial<{ grossSales: number; platformFee: number; refunds: number; netPayable: number; scheduledDate: string; notes: string; type: string }>
) {
  await getOwned(tenantId, id);
  const [row] = await db
    .update(settlements)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(settlements.tenantId, tenantId), eq(settlements.id, id), isNull(settlements.deletedAt)))
    .returning();
  if (!row) throw notFound('Settlement not found');
  return row;
}

export async function deleteSettlement(tenantId: string, id: string) {
  const [row] = await db
    .update(settlements)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(settlements.tenantId, tenantId), eq(settlements.id, id), isNull(settlements.deletedAt)))
    .returning();
  if (!row) throw notFound('Settlement not found');
  return row;
}

export function isValidStatus(s: string): s is SettlementStatus {
  return (VALID_STATUSES as readonly string[]).includes(s);
}

export function assertStatus(s: string): SettlementStatus {
  if (!isValidStatus(s)) throw badRequest('Invalid settlement status');
  return s;
}
