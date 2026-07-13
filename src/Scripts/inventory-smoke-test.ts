import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { inventoryReservations, ticketTypes } from '../db/schema/index.js';
import inventory from '../modules/inventory/service.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

interface ApiError {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
}

interface RequestResult<T> {
  status: number;
  ok: boolean;
  data: T | ApiError | null;
  raw: string;
}

interface AuthResult {
  user: { id: string; username: string; email: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface TenantRecord {
  id: string;
  slug: string;
}

interface VenueRecord {
  id: string;
}

interface EventRecord {
  id: string;
}

interface TicketTypeRecord {
  id: string;
  eventId: string;
  slug: string;
  soldQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

interface BookingOrderRecord {
  id: string;
  orderNumber: string;
  status: 'draft' | 'pending' | 'confirmed' | 'paid' | 'completed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function headersToObject(headers?: HeadersInit) {
  return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
}

function authHeaders(accessToken: string, tenantSlug?: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(tenantSlug ? { 'x-tenant-slug': tenantSlug } : {})
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...headersToObject(options.headers)
    },
    ...options
  });

  const raw = await response.text();
  let data: T | ApiError | null = null;

  if (raw.trim().length > 0) {
    try {
      data = JSON.parse(raw) as T | ApiError;
    } catch {
      data = null;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    raw
  };
}

function extractSuccess<T>(result: RequestResult<ApiSuccess<T>>, label: string) {
  assert(result.ok, `${label} failed`, result.data ?? result.raw);
  const payload = result.data as ApiSuccess<T> | null;
  assert(payload?.success === true, `${label} returned invalid payload`, result.data ?? result.raw);
  return payload.data;
}

function expectStatus(result: RequestResult<unknown>, statuses: number[], label: string) {
  assert(statuses.includes(result.status), `${label} expected ${statuses.join(', ')} but got ${result.status}`, result.data ?? result.raw);
}

async function signupUser(prefix: string, label: string) {
  const stamp = Date.now();
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const payload = {
    username: `${prefix}_${stamp}`,
    fullName: label,
    email: `${prefix}_${stamp}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+91999911${phoneSuffix}`
  };

  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const { verificationSessionId } = extractSuccess(startResponse, `${label} signup start`);

  const verifyResponse = await request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: JSON.stringify({
      verificationSessionId,
      code: '123456'
    })
  });

  return extractSuccess(verifyResponse, `${label} signup verify`);
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<TenantRecord>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ name, description: `${name} tenant` })
  });

  return extractSuccess(response, 'create tenant');
}

async function createVenue(accessToken: string, tenantSlug: string) {
  const response = await request<ApiSuccess<VenueRecord>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      name: 'Inventory Test Arena',
      addressLine1: 'Test Street',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India'
    })
  });

  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string) {
  const response = await request<ApiSuccess<EventRecord>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      title: 'Inventory Test Event',
      shortDescription: 'Inventory verification event',
      description: 'Used to validate reservation flows.',
      startDateTime: '2026-10-16T14:00:00.000Z',
      endDateTime: '2026-10-16T20:00:00.000Z',
      timezone: 'Asia/Kolkata',
      venueId,
      status: 'draft',
      visibility: 'public'
    })
  });

  return extractSuccess(response, 'create event');
}

async function createTicketType(accessToken: string, tenantSlug: string, eventId: string, totalQuantity: number) {
  const response = await request<ApiSuccess<TicketTypeRecord>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      eventId,
      name: 'Inventory Test Ticket',
      price: 1500,
      totalQuantity,
      minPerOrder: 1,
      maxPerOrder: 2,
      status: 'active',
      visibility: 'public'
    })
  });

  return extractSuccess(response, 'create ticket type');
}

async function run() {
  console.log('INVENTORY SMOKE TEST START');
  console.log(`Base URL: ${BASE_URL}`);

  const owner = await signupUser('inventory_owner', 'Inventory Owner');
  const tenant = await createTenant(owner.tokens.accessToken, 'Inventory Tenant');
  const venue = await createVenue(owner.tokens.accessToken, tenant.slug);
  const event = await createEvent(owner.tokens.accessToken, tenant.slug, venue.id);
  const concurrencyTicket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id, 1);
  const workflowTicket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id, 2);

  const concurrent = await Promise.all([
    request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
      method: 'POST',
      headers: authHeaders(owner.tokens.accessToken, tenant.slug),
      body: JSON.stringify({
        eventId: event.id,
        purchaserUserId: owner.user.id,
        status: 'pending',
        source: 'web',
        items: [{ ticketTypeId: concurrencyTicket.id, quantity: 1 }]
      })
    }),
    request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
      method: 'POST',
      headers: authHeaders(owner.tokens.accessToken, tenant.slug),
      body: JSON.stringify({
        eventId: event.id,
        purchaserUserId: owner.user.id,
        status: 'pending',
        source: 'web',
        items: [{ ticketTypeId: concurrencyTicket.id, quantity: 1 }]
      })
    })
  ]);

  const successes = concurrent.filter((result) => result.ok);
  const conflicts = concurrent.filter((result) => result.status === 409);
  assert(successes.length === 1, 'exactly one concurrent reservation should succeed', concurrent.map((result) => ({ status: result.status, raw: result.raw })));
  assert(conflicts.length === 1, 'exactly one concurrent reservation should conflict', concurrent.map((result) => ({ status: result.status, raw: result.raw })));

  const expiringReservations = await inventory.reserveInventoryWithoutOrder(db, {
    tenantId: tenant.id,
    eventId: event.id,
    items: [{ ticketTypeId: workflowTicket.id, quantity: 1 }],
    expiresAt: new Date(Date.now() + 60_000),
    metadata: { case: 'expiry' }
  });

  assert(expiringReservations.length === 1, 'expiry setup should create one reservation', expiringReservations);

  await db.update(inventoryReservations).set({ expiresAt: new Date(Date.now() - 60_000), updatedAt: new Date() }).where(eq(inventoryReservations.id, expiringReservations[0].id));

  const expired = await inventory.expireDueReservations(db, { tenantId: tenant.id, batchSize: 10 });
  assert(expired.length >= 1, 'expected at least one expired reservation', expired);

  const afterExpiry = await inventory.getInventorySummaries(db, tenant.id, [workflowTicket.id]);
  const summaryAfterExpiry = afterExpiry.get(workflowTicket.id);
  assert(summaryAfterExpiry?.reservedQuantity === 0, 'expired reservation should not count toward reserved inventory', summaryAfterExpiry);
  assert(summaryAfterExpiry?.availableQuantity === 2, 'expired reservation should restore availability', summaryAfterExpiry);

  const confirmed = await request<ApiSuccess<BookingOrderRecord>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'confirmed',
      source: 'web',
      items: [{ ticketTypeId: workflowTicket.id, quantity: 1 }]
    })
  });
  const confirmedOrder = extractSuccess(confirmed, 'create confirmed booking order');

  const secondConversion = await inventory.convertReservationsForBookingOrder(db, {
    tenantId: tenant.id,
    bookingOrderId: confirmedOrder.id,
    eventType: 'booking_confirmed'
  });
  assert(secondConversion.length === 0, 'confirmed order conversion should be idempotent after the initial booking flow', secondConversion);

  await db.update(ticketTypes).set({ totalQuantity: 500, soldQuantity: 99, reservedQuantity: 77, updatedAt: new Date() }).where(eq(ticketTypes.id, workflowTicket.id));

  const drifts = await inventory.reconcileCachedInventory(db, {
    tenantId: tenant.id,
    ticketTypeIds: [workflowTicket.id],
    repair: true
  });
  assert(drifts.length === 1, 'inventory reconciliation should detect the drift', drifts);

  const [repairedTicket] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, workflowTicket.id)).limit(1);
  assert(repairedTicket?.soldQuantity === 1, 'cache sold quantity should be repaired to derived value', repairedTicket);
  assert(repairedTicket?.reservedQuantity === 0, 'cache reserved quantity should be repaired to derived value', repairedTicket);

  console.log('INVENTORY SMOKE TEST PASSED');
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('INVENTORY SMOKE TEST FAILED');
    console.error(error);
    process.exit(1);
  });

export {};