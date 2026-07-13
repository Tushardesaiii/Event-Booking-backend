import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ledgerTransactions, ledgerAccounts, ledgerEntries } from '../db/schema/ledger.js';
import { env } from '../config/env.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = true;

interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

interface RequestResult<T> {
  status: number;
  ok: boolean;
  data: T | any | null;
  raw: string;
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
  let data: T | any = null;

  if (raw.trim().length > 0) {
    try {
      data = JSON.parse(raw);
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
    raw
  };
}

function extractSuccess<T>(result: RequestResult<ApiSuccess<T>>, label: string): T {
  assert(result.ok, `${label} failed (status: ${result.status})`, result.data ?? result.raw);
  const payload = result.data as ApiSuccess<T> | null;
  assert(payload?.success === true, `${label} returned invalid payload`, result.data ?? result.raw);
  return payload.data;
}

async function signup(username: string) {
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `Finance User ${username}`,
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
    body: JSON.stringify({ name, description: 'Finance testing tenant' })
  });
  return extractSuccess(response, `create tenant ${name}`);
}

async function run() {
  console.log('============================================================');
  console.log('ENTERPRISE LEDGER & FINANCE SMOKE TESTS STARTING...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('============================================================');

  const stamp = Date.now();
  const owner = await signup(`fin_owner_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Finance Tenant ${stamp}`);

  const headers = authHeaders(owner.tokens.accessToken, tenant.slug);

  // 1. Check dynamic Accounts listing (should return default empty list or core registry accounts)
  console.log('\n--- 1. Fetching Ledger Accounts list ---');
  const accountsRes = await request<ApiSuccess<any[]>>('/finance/accounts', { headers });
  const accounts = extractSuccess(accountsRes, 'List accounts');
  console.log(`✓ Ledger accounts returned. Found: ${accounts.length} accounts.`);

  // 2. Fetch empty Trial Balance (should be balanced at 0.00)
  console.log('\n--- 2. Fetching Trial Balance ---');
  const trialBalanceRes = await request<ApiSuccess<any>>('/finance/trial-balance', { headers });
  const trialBalance = extractSuccess(trialBalanceRes, 'Trial balance');
  assert(trialBalance.balanced === true, 'Trial balance must be balanced');
  assert(Number(trialBalance.totalDebits) === 0, 'Initial trial balance debits should be 0');
  console.log(`✓ Initial Trial Balance check passed. Total: ${trialBalance.totalDebits} INR.`);

  // 3. Create a transaction using booking checkout to generate ledger entries
  console.log('\n--- 3. Simulating Payment checkout transaction to seed entries ---');
  // First, we need to create organizer, venue, event, ticket type and booking order
  // Create Organizer
  const organizerRes = await request<ApiSuccess<any>>('/organizers', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Vibe Enterprise',
      displayName: 'Vibe Ent',
      slug: `vibe-ent-${stamp}`,
      description: 'Enterprise event organizer',
      supportEmail: 'support@vibeent.com',
      verificationStatus: 'verified'
    })
  });
  const organizer = extractSuccess(organizerRes, 'Create organizer');

  // Verify organizer in DB
  await db.execute(sql`UPDATE organizers SET verification_status = 'verified' WHERE id = ${organizer.id}`);

  // Create Venue
  const venueRes = await request<ApiSuccess<any>>('/venues', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Vibe Stadium',
      addressLine1: 'Central Arena',
      city: 'Delhi',
      state: 'Delhi',
      country: 'India',
      capacity: 10000
    })
  });
  const venue = extractSuccess(venueRes, 'Create venue');

  // Create Event
  const eventRes = await request<ApiSuccess<any>>('/events', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Global Tech Expo',
      shortDescription: 'Enterprise AI & Tech showcase',
      description: 'The premium engineering event',
      startDateTime: new Date(Date.now() + 86400 * 1000).toISOString(),
      endDateTime: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId: venue.id,
      organizerId: organizer.id
    })
  });
  const event = extractSuccess(eventRes, 'Create event');
  await db.execute(sql`UPDATE events SET organizer_id = ${organizer.id} WHERE id = ${event.id}`);

  // Create Ticket Type
  const ticketRes = await request<ApiSuccess<any>>('/ticket-types', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      eventId: event.id,
      name: 'Platinum Pass',
      price: 5000,
      totalQuantity: 100,
      minPerOrder: 1,
      maxPerOrder: 5,
      status: 'active',
      visibility: 'public',
      currency: 'INR',
      taxBehavior: 'exclusive',
      isRefundable: true
    })
  });
  const ticket = extractSuccess(ticketRes, 'Create ticket type');

  // Create Booking
  const bookingRes = await request<ApiSuccess<any>>('/booking-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: ticket.id, quantity: 1 }] // 5000 price
    })
  });
  const booking = extractSuccess(bookingRes, 'Create booking order');

  // Create payment order
  const createOrderRes = await request<ApiSuccess<any>>('/payments/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify({ bookingOrderId: booking.id })
  });
  const rzpOrder = extractSuccess(createOrderRes, 'Create payment order');

  // Verify/Capture payment (simulating Razorpay signature capture webhook)
  const razorpayPaymentId = `pay_fin_smoke_${Date.now()}`;
  const crypto = await import('node:crypto');
  const hmacSecret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
  const signature = crypto.createHmac('sha256', hmacSecret)
    .update(`${rzpOrder.orderId}|${razorpayPaymentId}`)
    .digest('hex');

  console.log('--- Triggering payment signature capture verification ---');
  const verifyRes = await request<ApiSuccess<any>>('/payments/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      razorpayOrderId: rzpOrder.orderId,
      razorpayPaymentId,
      razorpaySignature: signature
    })
  });
  assert(verifyRes.status === 200, 'Verify payment signature endpoint failed');

  // 4. Verify Ledger Transactions listing has our transaction
  console.log('\n--- 4. Checking Ledger Transactions & Cryptographic hash ---');
  const txsRes = await request<ApiSuccess<any[]>>('/finance/transactions', { headers });
  const txs = extractSuccess(txsRes, 'List transactions');
  assert(txs.length >= 1, 'Expected at least 1 ledger transaction posted');
  const paymentTx = txs.find(t => t.transactionType === 'TICKET_PURCHASE_CAPTURE');
  assert(paymentTx, 'Expected payment capture ledger transaction posted');
  assert(paymentTx.currentHash !== null && paymentTx.currentHash !== undefined, 'Transaction hash should be populated');
  console.log(`✓ Ledger Transaction found. Hash signature: ${paymentTx.currentHash}`);

  // 5. Test Cryptographic Chain Integrity endpoint
  console.log('\n--- 5. Checking Cryptographic Chain Integrity check ---');
  const integrityRes = await request<ApiSuccess<any>>('/finance/integrity-check', { headers });
  const integrity = extractSuccess(integrityRes, 'Verify chain');
  assert(integrity.healthy === true, 'General ledger cryptographic chain integrity should be healthy');
  console.log('✓ Cryptographic chain verification reported HEALTHY = true.');

  // 6. Simulate Tamper Check (database manipulation detection)
  console.log('\n--- 6. Simulating database tampering detection ---');
  const oldAmount = paymentTx.amount;
  // Modify the transaction amount directly in the database (bypass ledger service)
  await db.execute(sql`UPDATE ledger_transactions SET amount = '9999.00' WHERE id = ${paymentTx.id}`);
  console.log(`[Tamper Mode] Directly changed transaction ${paymentTx.id} amount from ${oldAmount} to 9999.00`);

  const tamperedIntegrityRes = await request<ApiSuccess<any>>('/finance/integrity-check', { headers });
  const tamperedIntegrity = extractSuccess(tamperedIntegrityRes, 'Verify chain tampered');
  
  assert(tamperedIntegrity.healthy === false, 'Cryptographic chain verification should fail when database is manipulated');
  assert(tamperedIntegrity.errors.length > 0, 'Expected validation error messages explaining hash mismatch');
  console.log(`✓ Tampering successfully detected! Error message: "${tamperedIntegrity.errors[0]}"`);

  // Restore database
  await db.execute(sql`UPDATE ledger_transactions SET amount = ${oldAmount} WHERE id = ${paymentTx.id}`);
  console.log('[Tamper Mode] Restored original transaction details.');

  const restoredIntegrityRes = await request<ApiSuccess<any>>('/finance/integrity-check', { headers });
  const restoredIntegrity = extractSuccess(restoredIntegrityRes, 'Verify chain restored');
  assert(restoredIntegrity.healthy === true, 'Chain integrity should be healthy after restoring details');
  console.log('✓ Chain integrity restored. Checks out healthy again.');

  // 7. Verify dynamic read-model Projections and rebuild worker
  console.log('\n--- 7. Verifying Balance Projections & Rebuild worker ---');
  const trialResBefore = await request<ApiSuccess<any>>('/finance/trial-balance', { headers });
  const trialBefore = extractSuccess(trialResBefore, 'Get Trial balance');

  // Trigger rebuild
  const rebuildRes = await request<ApiSuccess<any>>('/finance/projections/rebuild', { method: 'POST', headers });
  assert(rebuildRes.status === 200, 'Rebuild projections endpoint failed');

  const trialResAfter = await request<ApiSuccess<any>>('/finance/trial-balance', { headers });
  const trialAfter = extractSuccess(trialResAfter, 'Get Trial balance after rebuild');
  assert(trialBefore.totalDebits === trialAfter.totalDebits, 'Rebuilt balances must match pre-rebuild state');
  console.log('✓ Projections rebuilt successfully. Balances are correct.');

  console.log('\n============================================================');
  console.log('ALL ENTERPRISE LEDGER & FINANCE SMOKE TESTS PASSED!');
  console.log('============================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ ENTERPRISE LEDGER SMOKE TEST FAILED:\n');
  console.error(err);
  process.exit(1);
});
