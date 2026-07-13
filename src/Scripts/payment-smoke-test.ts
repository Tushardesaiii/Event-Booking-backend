import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import readline from 'node:readline';
import { env } from '../config/env.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

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
    if (raw.trim()) {
      console.log(raw);
    }
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

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
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

async function createOrganizer(accessToken: string, tenantSlug: string, name: string) {
  const response = await request<ApiSuccess<any>>('/organizers', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      name,
      description: 'Smoke test organizer description',
      city: 'Mumbai',
      country: 'India'
    })
  });
  return extractSuccess(response, 'create organizer');
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
      price: 2500,
      totalQuantity: 10,
      minPerOrder: 1,
      maxPerOrder: 10,
      status: 'active',
      visibility: 'public',
      currency: 'INR',
      taxBehavior: 'exclusive'
    })
  });
  return extractSuccess(response, 'create ticket type');
}

async function run() {
  console.log('REAL PAYMENTS TEST MODE SMOKE TEST STARTING...');
  console.log(`Base URL: ${BASE_URL}`);

  const stamp = Date.now();
  const owner = await signup(`pay_owner_${stamp}`);
  const customer = await signup(`pay_cust_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Pay Tenant ${stamp}`);
  
  // Add customer to tenant as member (viewer) to allow booking tickets
  await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: JSON.stringify({
      userId: customer.user.id,
      role: 'viewer'
    })
  });

  // 1. Create tenant & organizer
  console.log('\n--- 1. Creating Organizer ---');
  const organizer = await createOrganizer(owner.tokens.accessToken, tenant.slug, `Org ${stamp}`);
  console.log(`✓ Organizer profile created: ${organizer.id}`);

  const venue = await createVenue(owner.tokens.accessToken, tenant.slug);
  const event = await createEvent(owner.tokens.accessToken, tenant.slug, venue.id, organizer.id);
  const ticket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id);

  // 2. Create booking order in pending state
  console.log('\n--- 2. Creating Booking Order ---');
  const bookingRes = await request<ApiSuccess<any>>('/booking-orders', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: customer.user.id,
      status: 'pending',
      source: 'web',
      items: [
        { ticketTypeId: ticket.id, quantity: 2 }
      ]
    })
  });
  const booking = extractSuccess(bookingRes, 'create booking');
  assert(booking.status === 'pending', 'Booking status should be pending');
  console.log(`✓ Booking created: ${booking.id}, status: ${booking.status}`);

  // 3. Create real Razorpay order via POST /payments/create-order
  console.log('\n--- 3. Creating Real Razorpay Order ---');
  const idempotencyKey = `idemp-${Date.now()}`;
  const createOrderRes = await request<ApiSuccess<any>>('/payments/create-order', {
    method: 'POST',
    headers: {
      ...authHeaders(customer.tokens.accessToken, tenant.slug),
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ bookingOrderId: booking.id })
  });
  const rzpOrder = extractSuccess(createOrderRes, 'create payment order');
  assert(rzpOrder.orderId.startsWith('order_'), 'Expected real Razorpay Order ID starting with order_');
  console.log(`✓ Real Razorpay order successfully created: ${rzpOrder.orderId}`);
  console.log(`✓ Amount (Paise): ${rzpOrder.amount}`);

  // Test idempotency
  console.log('\n--- 3b. Testing Idempotency on create-order ---');
  const createOrderDupRes = await request<ApiSuccess<any>>('/payments/create-order', {
    method: 'POST',
    headers: {
      ...authHeaders(customer.tokens.accessToken, tenant.slug),
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ bookingOrderId: booking.id })
  });
  expectStatus(createOrderDupRes, [200, 201], 'idempotent call');
  assert(createOrderDupRes.headers.get('X-Cache-Idempotency') === 'HIT', 'Expected idempotency cache hit');
  console.log('✓ Idempotency layer successfully returned existing Order ID');

  // 4. Pause and instruct the developer to complete payment
  console.log('\n================================================================');
  console.log('ACTION REQUIRED: COMPLETE PAYMENTS IN RAZORPAY TEST CHOUTOUT');
  console.log(`Order ID: ${rzpOrder.orderId}`);
  console.log(`Amount: INR ${rzpOrder.amount / 100}`);
  console.log('----------------------------------------------------------------');
  console.log('Please proceed to complete the payment for this order.');
  console.log('You can write a simple checkout page or run it via Razorpay Checkout.');
  console.log('Once completed, paste the payment details below to verify.');
  console.log('================================================================\n');

  let razorpayPaymentId = process.env.SMOKE_TEST_PAYMENT_ID || '';
  let razorpaySignature = process.env.SMOKE_TEST_SIGNATURE || '';

  if (!razorpayPaymentId || !razorpaySignature) {
    razorpayPaymentId = await askQuestion('Enter razorpay_payment_id: ');
    razorpaySignature = await askQuestion('Enter razorpay_signature: ');
  } else {
    console.log(`Using credentials from env variables:`);
    console.log(`Payment ID: ${razorpayPaymentId}`);
    console.log(`Signature: ${razorpaySignature}`);
  }

  assert(razorpayPaymentId && razorpayPaymentId.startsWith('pay_'), 'Invalid Payment ID structure');
  assert(razorpaySignature, 'Signature is required');

  // 5. Verify the payment through the backend
  console.log('\n--- 5. Verifying Checkout Payment Signature through Backend ---');
  const verifyRes = await request<ApiSuccess<any>>('/payments/verify', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      razorpayOrderId: rzpOrder.orderId,
      razorpayPaymentId,
      razorpaySignature
    })
  });
  extractSuccess(verifyRes, 'verify signature');
  console.log('✓ Payment verified and captured successfully');

  // 6. Confirm booking becomes Paid
  console.log('\n--- 6. Verifying Booking Order status is Paid ---');
  const fetchBookingRes = await request<ApiSuccess<any>>(`/booking-orders/${booking.orderNumber}`, {
    headers: authHeaders(customer.tokens.accessToken, tenant.slug)
  });
  const updatedBooking = extractSuccess(fetchBookingRes, 'fetch updated booking');
  assert(updatedBooking.status === 'paid', 'Expected booking order status to be paid');
  assert(updatedBooking.confirmedAt !== null, 'Expected booking order confirmedAt to be set');
  console.log(`✓ Booking order successfully confirmed, status is: ${updatedBooking.status}`);

  // Fetch attendees list
  const assigneesRes = await request<ApiSuccess<any[]>>(`/booking-orders/${booking.orderNumber}/attendees`, {
    headers: authHeaders(customer.tokens.accessToken, tenant.slug)
  });
  const attendees = extractSuccess(assigneesRes, 'list attendees');
  console.log(`✓ Attendee ticket allocations created: ${attendees.length} records`);

  // Lookup the transaction ID in the database
  const { paymentTransactions: dbTransactions } = await import('../db/schema/payments.js');
  const [dbTx] = await (await import('../db/client.js')).db
    .select()
    .from(dbTransactions)
    .where(eq(dbTransactions.razorpayPaymentId, razorpayPaymentId))
    .limit(1);

  assert(dbTx, 'Expected payment transaction to exist in database');
  console.log(`✓ Persisted Payment Transaction ID: ${dbTx.id}, status: ${dbTx.status}`);

  // 7. Execute a real refund
  console.log('\n--- 7. Initiating Real Partial Refund ---');
  const refundKey = `refund-${Date.now()}`;
  const refundRes = await request<ApiSuccess<any>>('/payments/refund', {
    method: 'POST',
    headers: {
      ...authHeaders(owner.tokens.accessToken, tenant.slug),
      'Idempotency-Key': refundKey
    },
    body: JSON.stringify({
      paymentTransactionId: dbTx.id,
      amount: 2500, // partial refund of 2500.00 INR (less than total order cost)
      reason: 'Partial customer cancellation'
    })
  });
  const refundResult = extractSuccess(refundRes, 'process refund');
  assert(refundResult.status === 'processed', 'Refund should be processed');
  assert(refundResult.razorpayRefundId.startsWith('rfnd_'), 'Expected refund ID to start with rfnd_');
  console.log(`✓ Real Refund ID generated: ${refundResult.razorpayRefundId}`);
  console.log(`✓ Refund processed successfully: ${refundResult.id}, status: ${refundResult.status}`);

  // Test Refund Limit Enforcement
  console.log('\n--- 7b. Testing Refund Limit Enforcement ---');
  const overRefundRes = await request<any>('/payments/refund', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: JSON.stringify({
      paymentTransactionId: dbTx.id,
      amount: 5000, // exceeds remaining refundable balance
      reason: 'Over-refund attempt'
    })
  });
  expectStatus(overRefundRes, [400], 'over-refund request');
  console.log('✓ Over-refund attempt successfully rejected with 400 Bad Request');

  // Verify booking order status updated to partially_refunded
  const fetchBookingAfterRefund = await request<ApiSuccess<any>>(`/booking-orders/${booking.orderNumber}`, {
    headers: authHeaders(customer.tokens.accessToken, tenant.slug)
  });
  const refundedBooking = extractSuccess(fetchBookingAfterRefund, 'fetch booking after refund');
  assert(refundedBooking.status === 'partially_refunded', 'Expected booking status to be partially_refunded');
  console.log(`✓ Verified booking order status changed to: ${refundedBooking.status}`);

  // 8. Fetch payment details from Razorpay client
  console.log('\n--- 8. Fetching Payment details from Razorpay API ---');
  const { razorpayClient } = await import('../lib/razorpay.js');
  const rzpPaymentDetails = await razorpayClient.fetchPayment(razorpayPaymentId);
  console.log(`✓ Fetched payment status: ${rzpPaymentDetails.status}`);
  console.log(`✓ Razorpay Payment Amount: ${rzpPaymentDetails.amount / 100} ${rzpPaymentDetails.currency}`);
  assert(rzpPaymentDetails.id === razorpayPaymentId, 'Payment ID must match');

  // 9. Fetch refund details from Razorpay client
  console.log('\n--- 9. Fetching Refund details from Razorpay API ---');
  const rzpRefunds = await razorpayClient.listRefunds({ count: 10 });
  const matchingRefund = rzpRefunds.items?.find((r: any) => r.payment_id === razorpayPaymentId);
  assert(matchingRefund, 'Expected to find refund record in Razorpay API list');
  console.log(`✓ Fetched Razorpay Refund status: ${matchingRefund.status}`);
  console.log(`✓ Refunded ID: ${matchingRefund.id}`);
  console.log(`✓ Razorpay Refund Amount: ${matchingRefund.amount / 100}`);

  // 10. Verify reconciliation
  console.log('\n--- 10. Running Reconciliation ---');
  const reconRunRes = await request<ApiSuccess<any>>('/admin/reconciliation/run', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const reconRunResult = extractSuccess(reconRunRes, 'reconciliation run');
  console.log(`✓ Reconciliation run completed. Anomalies detected: ${reconRunResult.anomaliesCount}`);

  // 11. Verify ledger integrity
  console.log('\n--- 11. Checking Financial Ledger Integrity ---');
  const integrityRes = await request<ApiSuccess<any>>('/admin/payments/integrity-check', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const integrityReport = extractSuccess(integrityRes, 'integrity check');
  assert(integrityReport.status === 'ok', 'Ledger integrity check should be OK');
  console.log(`✓ Ledger status: ${integrityReport.status}`);

  // 12. Verify wallet balances
  console.log('\n--- 12. Verifying Wallet balances ---');
  const walletRes = await request<ApiSuccess<any>>('/organizer/wallet', {
    method: 'GET',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const walletData = extractSuccess(walletRes, 'get wallet');
  console.log(`✓ Wallet pending balance: ${walletData.pendingBalance}`);
  console.log(`✓ Wallet available balance: ${walletData.availableBalance}`);

  // 13. Verify health check reachability
  console.log('\n--- 13. Checking GET /health check endpoint ---');
  const healthRes = await request<any>('/health');
  expectStatus(healthRes, [200], 'health check');
  assert(healthRes.data?.success === true, 'Health check should return success');
  assert(healthRes.data?.data?.services?.razorpay?.status === 'ok', 'Razorpay should be healthy');
  assert(healthRes.data?.data?.services?.payments?.status === 'ok', 'Payments status should be healthy');
  console.log('✓ Health check contains healthy razorpay and payments status indicators');

  // 14. Verify Prometheus metrics exports
  console.log('\n--- 14. Checking GET /metrics metrics endpoint ---');
  const metricsRes = await request<any>('/metrics');
  expectStatus(metricsRes, [200], 'metrics endpoint');
  assert(metricsRes.raw.includes('payments_created_total'), 'Metrics should export payments_created_total');
  assert(metricsRes.raw.includes('payments_success_total'), 'Metrics should export payments_success_total');
  console.log('✓ Verified payments, reconciliation, and ledger prometheus metrics presence');

  console.log('\n============================================================');
  console.log('REAL PAYMENTS TEST MODE SMOKE TEST COMPLETED SUCCESSFULLY!');
  console.log('============================================================');
}

run().catch((error) => {
  console.error('\n❌ REAL PAYMENTS SMOKE TEST FAILED\n');
  console.error(error);
  process.exit(1);
});
