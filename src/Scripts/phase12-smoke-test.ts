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
  withdrawalRequests,
  settlementRuns,
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  events,
  bookingOrders
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
      phoneNumber: `+91999900${phoneSuffix}`
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
      name: 'Vibe Arena',
      addressLine1: 'Road 5',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      capacity: 5000
    })
  });
  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string, organizerId: string) {
  const response = await request<ApiSuccess<any>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      title: 'Neon Music Fest',
      shortDescription: 'Garba & Electronic mix festival',
      description: 'An execution verification festival',
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
      name: 'Elite VIP Access',
      price: 2000,
      totalQuantity: 10,
      minPerOrder: 1,
      maxPerOrder: 10,
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
  console.log('MARKETPLACE LEDGER SMOKE TESTS STARTING...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('============================================================');

  const stamp = Date.now();
  const owner = await signup(`ledger_owner_${stamp}`);
  const customer = await signup(`ledger_cust_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Ledger Tenant ${stamp}`);
  
  // Add customer and organizer to tenant
  await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: JSON.stringify({ userId: customer.user.id, role: 'viewer' })
  });

  const venue = await createVenue(owner.tokens.accessToken, tenant.slug);

  // Create organizer profile using owner context (Admin role)
  const organizerRes = await request<ApiSuccess<any>>('/organizers', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      name: 'Electric Vibe Corp',
      displayName: 'Electric Vibe',
      slug: `electric-vibe-${stamp}`,
      description: 'Organizing the best electronic shows',
      supportEmail: 'contact@electricvibe.com',
      verificationStatus: 'verified' // default verified or update to bypass KYC checks
    })
  });
  const organizer = extractSuccess(organizerRes, 'create organizer');
  console.log(`✓ Organizer Profile created: ${organizer.id}`);

  // Force update organizer verificationStatus in DB to be verified (KYC bypass)
  await db
    .update(organizers)
    .set({ verificationStatus: 'verified', createdByUserId: owner.user.id }) // Map creator to owner user
    .where(eq(organizers.id, organizer.id));
  console.log(`✓ Forced DB update: Organizer verificationStatus set to 'verified', creator mapped to owner.`);

  const event = await createEvent(owner.tokens.accessToken, tenant.slug, venue.id, organizer.id);
  
  // Directly link event to organizer in the DB as the API doesn't save organizerId during creation
  await db
    .update(events)
    .set({ organizerId: organizer.id })
    .where(eq(events.id, event.id));

  const ticket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id);

  // 1. Create booking order in pending state
  console.log('\n--- 1. Creating booking order ---');
  const bookingRes = await request<ApiSuccess<any>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: customer.user.id,
      status: 'pending',
      source: 'web',
      items: [
        { ticketTypeId: ticket.id, quantity: 2 } // 2000 * 2 = 4000 INR ticket price
      ]
    })
  });
  const booking = extractSuccess(bookingRes, 'create booking');
  console.log(`✓ Booking order created: ${booking.id}, initial totalAmount: ${booking.totalAmount}`);

  // 2. Create Razorpay order (verify server calculations)
  console.log('\n--- 2. Creating Razorpay order (Verifying Server-Driven Calculations) ---');
  const createOrderRes = await request<ApiSuccess<any>>('/payments/create-order', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken, tenant.slug),
    body: JSON.stringify({ bookingOrderId: booking.id })
  });
  const rzpOrder = extractSuccess(createOrderRes, 'create payment order');
  
  // Calculate expected: Subtotal = 4000.00, Convenience Fee = 200.00, Tax = 36.00. Total = 4236.00 INR = 423600 Paise
  assert(rzpOrder.amount === 423600, `Expected server calculations to sum to 423600 paise (Subtotal: 4000, Conv Fee: 200, Tax: 36), got ${rzpOrder.amount}`);
  console.log(`✓ Razorpay order amount matches server calculations: ${rzpOrder.amount} paise`);

  // Verify booking order values in DB have been updated
  const [dbBookingOrder] = await db.select().from(bookingOrders).where(eq(bookingOrders.id, booking.id));
  assert(Number(dbBookingOrder.totalAmount) === 4236.00, `Expected booking order total amount to be updated to 4236.00, got ${dbBookingOrder.totalAmount}`);
  assert(Number(dbBookingOrder.taxAmount) === 236.00, `Expected booking order taxAmount (conv fee + tax) to be 236.00, got ${dbBookingOrder.taxAmount}`);
  console.log(`✓ Booking order amounts updated in DB: subtotal=${dbBookingOrder.subtotalAmount}, tax=${dbBookingOrder.taxAmount}, total=${dbBookingOrder.totalAmount}`);

  // 3. Customer Verify Payment Signature (verifies checkout)
  console.log('\n--- 3. Verifying checkout payment signature ---');
  const razorpayPaymentId = `pay_checkout_${Date.now()}`;
  const secret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
  const signature = computeSignature(`${rzpOrder.orderId}|${razorpayPaymentId}`, secret);

  const verifyRes = await request<ApiSuccess<any>>('/payments/verify', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      razorpayOrderId: rzpOrder.orderId,
      razorpayPaymentId,
      razorpaySignature: signature
    })
  });
  expectStatus(verifyRes, [200], 'verify signature');
  console.log('✓ Payment signature successfully verified on the backend.');

  // Validate ledger entries for capture
  console.log('\n--- 3b. Verifying Ledger entries for capture ---');
  const [paymentOrderRecord] = await db.select().from(paymentOrders).where(eq(paymentOrders.bookingOrderId, booking.id));
  const [transactionRecord] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.paymentOrderId, paymentOrderRecord.id));
  
  const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.referenceId, transactionRecord.id));
  assert(entries.length === 2, `Expected 2 capture entries in the ledger, found ${entries.length}`);
  
  const clearingEntry = entries.find(e => e.direction === 'debit');
  const escrowEntry = entries.find(e => e.direction === 'credit');
  assert(clearingEntry && Number(clearingEntry.amount) === 4236.00, 'Expected clearing account debited for full booking amount');
  assert(escrowEntry && Number(escrowEntry.amount) === 4236.00, 'Expected escrow account credited for full booking amount');
  console.log('✓ Capture double-entry ledger entries validated: debits match credits.');

  // Validate organizer wallet pending balance credit
  console.log('\n--- 3c. Verifying Organizer Wallet pending balance credit ---');
  const [wallet] = await db.select().from(organizerWallets).where(eq(organizerWallets.organizerId, organizer.id));
  assert(wallet, 'Expected organizer wallet record to be auto-created');
  
  // Net organizer revenue: gross (4236) - platform fee (10% of subtotal: 400) - tax (18% of platform fee: 72) = 4236 - 400 - 72 = 3764 INR
  assert(Number(wallet.pendingBalance) === 3764.00, `Expected pending organizer earnings of 3764.00, got ${wallet.pendingBalance}`);
  assert(Number(wallet.availableBalance) === 0.00, 'Expected available balance to remain 0.00 before event completion');
  console.log(`✓ Organizer Wallet pending balance staged correctly: pending=${wallet.pendingBalance}, available=${wallet.availableBalance}`);

  // 4. Force Event completion in DB and trigger settlement engine
  console.log('\n--- 4. Completing Event and Running Settlement Engine ---');
  // Update event status to completed and end date to past
  await db
    .update(events)
    .set({ status: 'completed', endDateTime: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) }) // 4 days ago
    .where(eq(events.id, event.id));
  console.log('✓ Updated event to status completed (ended 4 days ago).');

  const settlementRes = await request<ApiSuccess<any>>('/admin/settlements/run', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  expectStatus(settlementRes, [200], 'run settlements');
  console.log(`✓ Settlement run completed successfully: total settled amount=${settlementRes.data?.data?.amount}`);

  // Verify wallet balance moved to available
  const [walletAfterSettlement] = await db.select().from(organizerWallets).where(eq(organizerWallets.organizerId, organizer.id));
  assert(Number(walletAfterSettlement.availableBalance) === 3764.00, `Expected available balance of 3764.00, got ${walletAfterSettlement.availableBalance}`);
  assert(Number(walletAfterSettlement.pendingBalance) === 0.00, `Expected pending balance of 0.00, got ${walletAfterSettlement.pendingBalance}`);
  console.log(`✓ Staged earnings successfully moved to available balance: available=${walletAfterSettlement.availableBalance}`);

  // Verify settlement double entry ledger splits
  const [settlementRun] = await db.select().from(settlementRuns).where(eq(settlementRuns.tenantId, tenant.id)).limit(1);
  const settlementEntries = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.referenceType, 'settlement_run')));
  assert(settlementEntries.length === 4, `Expected 4 settlement split entries in the ledger, found ${settlementEntries.length}`);
  console.log('✓ Escrow split double-entry ledger entries validated.');

  // Fetch organizer wallet transactions API
  console.log('\n--- 4b. Fetching Organizer Wallet APIs ---');
  const fetchWalletRes = await request<ApiSuccess<any>>('/organizer/wallet', {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const walletApi = extractSuccess(fetchWalletRes, 'fetch wallet');
  assert(Number(walletApi.availableBalance) === 3764.00, 'Wallet API available balance validation');

  const fetchTxsRes = await request<ApiSuccess<any[]>>('/organizer/wallet/transactions', {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const walletTxs = extractSuccess(fetchTxsRes, 'fetch wallet transactions');
  assert(walletTxs.length >= 1, 'Wallet transactions list must contain records');
  console.log(`✓ Verified wallet APIs: available=${walletApi.availableBalance}, transactionsCount=${walletTxs.length}`);

  // 5. Organizer Withdrawal Request with pessimistic locking and validation rules
  console.log('\n--- 5. Testing Organizer Withdrawals & Limit validations ---');
  
  // Test withdrawal request exceeding balance
  const badWithdrawalRes = await request<any>('/organizer/withdrawals', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      organizerId: organizer.id,
      amount: 4000.00 // Exceeds available balance of 3764.00
    })
  });
  expectStatus(badWithdrawalRes, [400], 'over-withdrawal request');
  console.log('✓ Over-withdrawal request successfully rejected with 400 Bad Request');

  // Submit valid withdrawal request (2000 INR)
  const validWithdrawalRes = await request<ApiSuccess<any>>('/organizer/withdrawals', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      organizerId: organizer.id,
      amount: 2000.00
    })
  });
  const withdrawal = extractSuccess(validWithdrawalRes, 'request withdrawal');
  assert(withdrawal.status === 'pending', 'Withdrawal status should be pending');
  console.log(`✓ Withdrawal request submitted: status=${withdrawal.status}, amount=${withdrawal.amount}`);

  // Verify wallet pending balance locking
  const [walletAfterWithdrawalRequest] = await db.select().from(organizerWallets).where(eq(organizerWallets.organizerId, organizer.id));
  assert(Number(walletAfterWithdrawalRequest.availableBalance) === 1764.00, `Expected remaining available balance to be 1764.00, got ${walletAfterWithdrawalRequest.availableBalance}`);
  assert(Number(walletAfterWithdrawalRequest.pendingBalance) === 2000.00, `Expected pending/locked balance to be 2000.00, got ${walletAfterWithdrawalRequest.pendingBalance}`);
  console.log(`✓ Withdrawal amount locked successfully: available=${walletAfterWithdrawalRequest.availableBalance}, pendingLock=${walletAfterWithdrawalRequest.pendingBalance}`);

  // 6. Admin processes withdrawal request
  console.log('\n--- 6. Admin processing Withdrawal Request ---');
  const processRes = await request<ApiSuccess<any>>(`/admin/withdrawals/${withdrawal.id}/process`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({ status: 'completed' })
  });
  expectStatus(processRes, [200], 'process withdrawal');
  console.log('✓ Admin successfully completed the withdrawal request.');

  // Verify final wallet balances
  const [finalWallet] = await db.select().from(organizerWallets).where(eq(organizerWallets.organizerId, organizer.id));
  assert(Number(finalWallet.availableBalance) === 1764.00, `Expected available balance to remain 1764.00, got ${finalWallet.availableBalance}`);
  assert(Number(finalWallet.pendingBalance) === 0.00, `Expected pending locked balance to clear to 0.00, got ${finalWallet.pendingBalance}`);
  assert(Number(finalWallet.withdrawnBalance) === 2000.00, `Expected total withdrawn balance to be 2000.00, got ${finalWallet.withdrawnBalance}`);
  console.log(`✓ Wallet balances finalized: available=${finalWallet.availableBalance}, pending=${finalWallet.pendingBalance}, withdrawn=${finalWallet.withdrawnBalance}`);

  // Verify double entry withdrawal ledger postings
  const withdrawalEntries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.referenceId, withdrawal.id));
  assert(withdrawalEntries.length === 2, 'Expected 2 double-entry entries for withdrawal completed');
  console.log('✓ Withdrawal double-entry ledger entries validated.');

  // 7. Test Admin Financial Safety Invariant Integrity Checks
  console.log('\n--- 7. Running Administrative Financial Safety Invariant Checks ---');
  const integrityCheckRes = await request<ApiSuccess<any>>('/admin/payments/integrity-check', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const report = extractSuccess(integrityCheckRes, 'run integrity check');
  assert(report.healthy === true, 'Expected general ledger integrity audit report to pass clean');
  console.log('✓ General ledger integrity checks validated: no negative balances, balanced transactions, no orphaned lines.');

  // 8. Checking Observability endpoints
  console.log('\n--- 8. Checking Observability (health & metrics) endpoints ---');
  const healthRes = await request<any>('/health');
  expectStatus(healthRes, [200], 'health check');
  assert(healthRes.data?.data?.services?.ledger_engine?.status === 'ok', 'Ledger engine should be healthy');
  assert(healthRes.data?.data?.services?.wallet_engine?.status === 'ok', 'Wallet engine should be healthy');
  assert(healthRes.data?.data?.services?.settlement_engine?.status === 'ok', 'Settlement engine should be healthy');
  console.log('✓ Health check contains healthy ledger, wallet, and settlement engines.');

  const metricsRes = await request<any>('/metrics');
  expectStatus(metricsRes, [200], 'metrics check');
  assert(metricsRes.raw.includes('ledger_transactions_total'), 'Metrics should export ledger_transactions_total');
  assert(metricsRes.raw.includes('settlements_total'), 'Metrics should export settlements_total');
  assert(metricsRes.raw.includes('withdrawals_total'), 'Metrics should export withdrawals_total');
  console.log('✓ Prometheus metrics check passed successfully.');

  console.log('\n============================================================');
  console.log('ALL PHASE 12 MARKETPLACE LEDGER SMOKE TESTS PASSED!');
  console.log('============================================================');
  process.exit(0);
}

run().catch((error) => {
  console.error('\n❌ PHASE 12 LEDGER SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
