import { createHmac } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import {
  paymentOrders,
  paymentTransactions,
  paymentRefunds,
  organizers,
  organizerWallets,
  organizerWalletTransactions,
  ledgerEntries,
  events,
  bookingOrders,
  paymentAuditLogs
} from '../db/schema/index.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = true;

interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: any;
}

interface ApiError {
  success: false;
  message: string;
  error: {
    code: string;
    details?: unknown;
  };
}

interface RequestResult<T> {
  status: number;
  ok: boolean;
  data: T | ApiError | null;
  raw: string;
  headers: Headers;
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function authHeaders(accessToken: string, tenantSlug?: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(tenantSlug ? { 'x-tenant-slug': tenantSlug } : {})
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<RequestResult<T>> {
  const headersObj = {
    'Content-Type': 'application/json',
    ...(options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : {})
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: headersObj
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

  if (VERBOSE) {
    console.log(`${response.status} ${options.method ?? 'GET'} ${path}`);
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    raw,
    headers: response.headers
  };
}

function extractSuccess<T>(result: RequestResult<ApiSuccess<T>>, label: string): T {
  assert(result.ok, `${label} failed (status: ${result.status})`, result.data ?? result.raw);
  const payload = result.data as ApiSuccess<T> | null;
  assert(payload?.success === true, `${label} returned invalid payload`, result.data ?? result.raw);
  return payload.data;
}

function expectStatus(result: RequestResult<unknown>, statuses: number[], label: string) {
  assert(statuses.includes(result.status), `${label} expected ${statuses.join(', ')} but got ${result.status}`, result.data ?? result.raw);
}

// Compute checkout signature
function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

async function signup(username: string) {
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `User ${username}`,
      username,
      email: `${username}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: `+91999911${phoneSuffix}`
    })
  });
  const { verificationSessionId } = extractSuccess(startResponse, `signup start ${username}`);

  const verifyResponse = await request<ApiSuccess<any>>('/auth/signup/verify', {
    method: 'POST',
    body: JSON.stringify({
      verificationSessionId,
      code: '123456'
    })
  });
  return extractSuccess(verifyResponse, `signup verify ${username}`);
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<any>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ name, description: 'Test description' })
  });
  return extractSuccess(response, `create tenant ${name}`);
}

async function createVenue(accessToken: string, tenantSlug: string) {
  const response = await request<ApiSuccess<any>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      name: 'Grand Pavilion',
      addressLine1: 'MG Road',
      city: 'Bangalore',
      state: 'Karnataka',
      country: 'India',
      capacity: 1000
    })
  });
  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string, organizerId: string) {
  const response = await request<ApiSuccess<any>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      title: 'Cross-Platform Dev Music Jam',
      shortDescription: 'Unifying Mobile & Web payments',
      description: 'An execution verification festival for Razorpay support',
      startDateTime: new Date(Date.now() + 86400 * 1000).toISOString(),
      endDateTime: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId,
      organizerId
    })
  });
  return extractSuccess(response, 'create event');
}

async function createTicketType(accessToken: string, tenantSlug: string, eventId: string) {
  const response = await request<ApiSuccess<any>>('/ticket-types', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      eventId,
      name: 'Super Fan VIP Pass',
      price: 1500, // 1500 INR
      totalQuantity: 20,
      minPerOrder: 1,
      maxPerOrder: 5,
      status: 'active',
      visibility: 'public',
      currency: 'INR',
      taxBehavior: 'exclusive',
      isRefundable: true
    })
  });
  return extractSuccess(response, 'create ticket type');
}

async function run() {
  console.log('============================================================');
  console.log('CROSS-PLATFORM RAZORPAY SMOKE TESTS STARTING...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('============================================================');

  const stamp = Date.now();
  const owner = await signup(`xp_owner_${stamp}`);
  const customerWeb = await signup(`xp_cust_web_${stamp}`);
  const customerMobile = await signup(`xp_cust_mob_${stamp}`);
  
  const tenant = await createTenant(owner.tokens.accessToken, `XP Tenant ${stamp}`);
  
  // Add customers to tenant
  await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: JSON.stringify({ userId: customerWeb.user.id, role: 'viewer' })
  });
  await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: JSON.stringify({ userId: customerMobile.user.id, role: 'viewer' })
  });

  const venue = await createVenue(owner.tokens.accessToken, tenant.slug);

  // Create organizer profile using owner context
  const organizerRes = await request<ApiSuccess<any>>('/organizers', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      name: 'Vibe Sync Productions',
      displayName: 'Vibe Sync',
      slug: `vibe-sync-${stamp}`,
      description: 'Cross platform shows',
      supportEmail: 'contact@vibesync.com',
      verificationStatus: 'verified'
    })
  });
  const organizer = extractSuccess(organizerRes, 'create organizer');

  // Bypass KYC in DB
  await db
    .update(organizers)
    .set({ verificationStatus: 'verified', createdByUserId: owner.user.id })
    .where(eq(organizers.id, organizer.id));

  const event = await createEvent(owner.tokens.accessToken, tenant.slug, venue.id, organizer.id);

  // Link event to organizer in DB
  await db
    .update(events)
    .set({ organizerId: organizer.id })
    .where(eq(events.id, event.id));

  const ticket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id);

  console.log('\n--- SETUP COMPLETE. RUNNING WEB FLOW (camelCase Verification) ---');
  
  // 1. Create Web Booking
  const bookingWebRes = await request<ApiSuccess<any>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(customerWeb.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: customerWeb.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: ticket.id, quantity: 1 }] // 1500 INR
    })
  });
  const bookingWeb = extractSuccess(bookingWebRes, 'web booking');
  console.log(`✓ Web booking created: ${bookingWeb.id}`);

  // 2. Create Web Payment Order
  const createOrderWebRes = await request<ApiSuccess<any>>('/payments/create-order', {
    method: 'POST',
    headers: authHeaders(customerWeb.tokens.accessToken, tenant.slug),
    body: JSON.stringify({ bookingOrderId: bookingWeb.id })
  });
  const orderWeb = extractSuccess(createOrderWebRes, 'web payment order');
  
  // Verify returned fields are enriched (checking presence of both cases)
  assert(orderWeb.orderId && orderWeb.order_id && orderWeb.razorpay_order_id, 'Web order missing Order ID variations');
  assert(orderWeb.keyId && orderWeb.key_id && orderWeb.key, 'Web order missing key variations');
  assert(orderWeb.prefill && orderWeb.prefill.name && orderWeb.prefill.email, 'Web order missing prefill data');
  assert(orderWeb.name === 'Cross-Platform Dev Music Jam', 'Expected event title as payment name');
  console.log(`✓ Web payment order has all enriched and cross-platform compatible fields`);

  // 3. Verify Web Signature using camelCase keys
  const payIdWeb = `pay_web_${Date.now()}`;
  const secret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
  const sigWeb = computeSignature(`${orderWeb.orderId}|${payIdWeb}`, secret);

  const verifyWebRes = await request<ApiSuccess<any>>('/payments/verify', {
    method: 'POST',
    headers: authHeaders(customerWeb.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      razorpayOrderId: orderWeb.orderId,
      razorpayPaymentId: payIdWeb,
      razorpaySignature: sigWeb
    })
  });
  expectStatus(verifyWebRes, [200], 'verify signature web');
  console.log('✓ Web payment verified successfully using camelCase fields.');

  // Validate ledger entries
  const [poWeb] = await db.select().from(paymentOrders).where(eq(paymentOrders.bookingOrderId, bookingWeb.id));
  const [txWeb] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.paymentOrderId, poWeb.id));
  const ledgerEntriesWeb = await db.select().from(ledgerEntries).where(eq(ledgerEntries.referenceId, txWeb.id));
  assert(ledgerEntriesWeb.length === 2, `Expected 2 ledger entries for web payment, got ${ledgerEntriesWeb.length}`);
  console.log('✓ Web ledger double-entries checked out.');

  // Validate wallet pending balance
  const [walletWeb] = await db.select().from(organizerWallets).where(eq(organizerWallets.organizerId, organizer.id));
  const pendingWeb = Number(walletWeb.pendingBalance);
  console.log(`✓ Web Wallet pending balance staged: ${pendingWeb}`);

  // Validate audit logs
  const auditsWeb = await db.select().from(paymentAuditLogs).where(eq(paymentAuditLogs.entityId, poWeb.id));
  assert(auditsWeb.some(a => a.action === 'create') && auditsWeb.some(a => a.action === 'capture'), 'Audit logs must capture create and capture actions');
  console.log('✓ Web audit logs checked out.');


  console.log('\n--- RUNNING MOBILE FLOW SIMULATION (snake_case Verification & bookingId) ---');

  // 1. Create Mobile Booking
  const bookingMobRes = await request<ApiSuccess<any>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(customerMobile.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: customerMobile.user.id,
      status: 'pending',
      source: 'mobile',
      items: [{ ticketTypeId: ticket.id, quantity: 1 }] // 1500 INR
    })
  });
  const bookingMob = extractSuccess(bookingMobRes, 'mobile booking');
  console.log(`✓ Mobile booking created: ${bookingMob.id}`);

  // 2. Create Mobile Payment Order using alternative 'bookingId' parameter
  const createOrderMobRes = await request<ApiSuccess<any>>('/payments/create-order', {
    method: 'POST',
    headers: authHeaders(customerMobile.tokens.accessToken, tenant.slug),
    body: JSON.stringify({ bookingId: bookingMob.id })
  });
  const orderMob = extractSuccess(createOrderMobRes, 'mobile payment order');
  
  // Verify returned fields are enriched
  assert(orderMob.order_id && orderMob.key && orderMob.prefill.contact && orderMob.theme.color, 'Mobile order missing SDK required options');
  console.log(`✓ Mobile payment order successfully resolved using alternative parameter bookingId and contains SDK options`);

  // 3. Verify Mobile Payment using snake_case parameter keys
  const payIdMob = `pay_mob_${Date.now()}`;
  const sigMob = computeSignature(`${orderMob.order_id}|${payIdMob}`, secret);

  const verifyMobRes = await request<ApiSuccess<any>>('/payments/verify', {
    method: 'POST',
    headers: authHeaders(customerMobile.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      razorpay_order_id: orderMob.order_id,
      razorpay_payment_id: payIdMob,
      razorpay_signature: sigMob
    })
  });
  expectStatus(verifyMobRes, [200], 'verify signature mobile');
  console.log('✓ Mobile payment verified successfully using snake_case fields.');

  // Validate ledger entries for mobile flow (must look exactly like web)
  const [poMob] = await db.select().from(paymentOrders).where(eq(paymentOrders.bookingOrderId, bookingMob.id));
  const [txMob] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.paymentOrderId, poMob.id));
  const ledgerEntriesMob = await db.select().from(ledgerEntries).where(eq(ledgerEntries.referenceId, txMob.id));
  assert(ledgerEntriesMob.length === 2, `Expected 2 ledger entries for mobile payment, got ${ledgerEntriesMob.length}`);
  
  // Assert both flows generated equivalent double-entries
  assert(Number(ledgerEntriesWeb[0].amount) === Number(ledgerEntriesMob[0].amount), 'Ledger amounts must match');
  assert(ledgerEntriesWeb[0].direction === ledgerEntriesMob[0].direction, 'Ledger directions must match');
  console.log('✓ Mobile double-entry ledger entries match the Web flow.');

  // Validate wallet pending balance increases identically
  const [walletMobAfter] = await db.select().from(organizerWallets).where(eq(organizerWallets.organizerId, organizer.id));
  const pendingAdded = Number(walletMobAfter.pendingBalance) - pendingWeb;
  assert(pendingAdded === pendingWeb, `Expected identical wallet pending balance increments (web: ${pendingWeb}, mobile: ${pendingAdded})`);
  console.log(`✓ Mobile Wallet pending balance credited identically: ${pendingAdded}`);

  // Validate audit logs for mobile flow
  const auditsMob = await db.select().from(paymentAuditLogs).where(eq(paymentAuditLogs.entityId, poMob.id));
  assert(auditsMob.some(a => a.action === 'create') && auditsMob.some(a => a.action === 'capture'), 'Audit logs must capture create and capture actions in mobile flow');
  console.log('✓ Mobile audit logs checked out.');


  console.log('\n--- VERIFYING REFUND AND SETTLEMENT BEHAVIOR (COMMON LOGIC) ---');

  // 1. Process Web Refund
  const refundWebRes = await request<ApiSuccess<any>>('/payments/refund', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      paymentTransactionId: txWeb.id,
      amount: 500, // 5 INR partial refund
      reason: 'Web partial refund'
    })
  });
  const refundWebResult = extractSuccess(refundWebRes, 'web refund');
  assert(refundWebResult.status === 'processed', 'Web refund should be successful');
  console.log('✓ Partial refund on Web payment succeeded.');

  // 2. Process Mobile Refund
  const refundMobRes = await request<ApiSuccess<any>>('/payments/refund', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      paymentTransactionId: txMob.id,
      amount: 500, // 5 INR partial refund
      reason: 'Mobile partial refund'
    })
  });
  const refundMobResult = extractSuccess(refundMobRes, 'mobile refund');
  assert(refundMobResult.status === 'processed', 'Mobile refund should be successful');
  console.log('✓ Partial refund on Mobile payment succeeded.');

  // 3. Complete Event & trigger settlements
  await db
    .update(events)
    .set({ status: 'completed', endDateTime: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) }) // completed 4 days ago
    .where(eq(events.id, event.id));
  console.log('✓ Forced DB update: Completed event to trigger settlement.');

  const settlementRes = await request<ApiSuccess<any>>('/admin/settlements/run', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  expectStatus(settlementRes, [200], 'run settlements');
  console.log(`✓ Settlement engine completed successfully: settled amount = ${settlementRes.data?.data?.amount}`);

  // Confirm final wallet available balance matches calculations for both
  const [finalWallet] = await db.select().from(organizerWallets).where(eq(organizerWallets.organizerId, organizer.id));
  console.log(`✓ Final available balance settled in wallet: ${finalWallet.availableBalance}`);
  assert(Number(finalWallet.availableBalance) > 0, 'Available balance should be credited after settlement');

  console.log('\n============================================================');
  console.log('CROSS-PLATFORM RAZORPAY SMOKE TESTS COMPLETED SUCCESSFULLY!');
  console.log('============================================================');
}

run().catch((error) => {
  console.error('\n❌ CROSS-PLATFORM SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
