import { createHmac } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
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

async function signup(username: string) {
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `User ${username}`,
      username,
      email: `${username}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: `+1555500${phoneSuffix}`
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
    body: JSON.stringify({ name, description: 'Tenant description for coins test' })
  });
  return extractSuccess(response, `create tenant ${name}`);
}

async function createOrganizer(accessToken: string, tenantSlug: string, name: string) {
  const response = await request<ApiSuccess<any>>('/organizers', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      name,
      description: 'Coins test organizer description',
      city: 'Mumbai',
      country: 'India'
    })
  });
  return extractSuccess(response, `create organizer ${name}`);
}

async function createVenue(accessToken: string, tenantSlug: string) {
  const response = await request<ApiSuccess<any>>('/venues', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      name: 'Grand Coins Pavilion',
      addressLine1: 'Holo High Street',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India'
    })
  });
  return extractSuccess(response, 'create venue');
}

async function createEvent(accessToken: string, tenantSlug: string, venueId: string, organizerId: string) {
  const response = await request<ApiSuccess<any>>('/events', {
    method: 'POST',
    headers: authHeaders(accessToken, tenantSlug),
    body: JSON.stringify({
      title: 'Coins & Refunds Launch Bash',
      shortDescription: 'Interactive testing of Revelis Coins & Refunds',
      description: 'Smoke test event for coins & refunds integration',
      startDateTime: '2026-11-20T18:00:00.000Z',
      endDateTime: '2026-11-20T23:59:59.000Z',
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
      name: 'Refundable Elite Pass',
      price: 1500,
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
  console.log('COINS AND REFUNDS SMOKE TEST STARTING...');
  console.log(`Base URL: ${BASE_URL}`);

  const stamp = Date.now();
  const owner = await signup(`coins_owner_${stamp}`);
  const customer = await signup(`coins_cust_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Coins Tenant ${stamp}`);

  // Add customer to tenant as viewer
  await request(`/tenants/${tenant.slug}/members`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken),
    body: JSON.stringify({
      userId: customer.user.id,
      role: 'viewer'
    })
  });

  const organizer = await createOrganizer(owner.tokens.accessToken, tenant.slug, `Coins Org ${stamp}`);
  const venue = await createVenue(owner.tokens.accessToken, tenant.slug);
  const event = await createEvent(owner.tokens.accessToken, tenant.slug, venue.id, organizer.id);
  const ticket = await createTicketType(owner.tokens.accessToken, tenant.slug, event.id);

  console.log('\n--- Step 1: Query Empty Wallet Balance ---');
  const getWalletRes = await request<ApiSuccess<any>>('/consumer/wallet', {
    headers: authHeaders(customer.tokens.accessToken)
  });
  const initialWallet = extractSuccess(getWalletRes, 'get initial wallet');
  console.log(`✓ Initial balance: ${initialWallet.wallet.balance}`);
  assert(parseFloat(initialWallet.wallet.balance) === 0, 'Initial balance should be 0');

  console.log('\n--- Step 2: Create Wallet Recharge Order ---');
  const createRechargeRes = await request<ApiSuccess<any>>('/consumer/wallet/recharge', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken),
    body: JSON.stringify({ amount: 5000 })
  });
  const rechargeOrder = extractSuccess(createRechargeRes, 'create recharge order');
  console.log(`✓ Recharge order created: ${rechargeOrder.razorpayOrderId}, amount: ${rechargeOrder.amount}`);
  assert(rechargeOrder.razorpayOrderId.startsWith('order_'), 'Expected order ID format');

  console.log('\n--- Step 3: Verify Recharge Signature ---');
  const secret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
  const razorpayPaymentId = `pay_recharge_${stamp}`;
  const razorpaySignature = createHmac('sha256', secret || 'mock_secret')
    .update(`${rechargeOrder.razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const verifyRechargeRes = await request<ApiSuccess<any>>('/consumer/wallet/recharge/verify', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken),
    body: JSON.stringify({
      razorpayOrderId: rechargeOrder.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    })
  });
  const verifyResult = extractSuccess(verifyRechargeRes, 'verify recharge');
  console.log(`✓ Verify response: success=${verifyResult.success}, newBalance=${verifyResult.balance}`);
  assert(verifyResult.success === true, 'Verify success should be true');
  assert(parseFloat(verifyResult.balance) === 5000, 'Recharged balance should be 5000');

  console.log('\n--- Step 4: Create Pending Booking Order ---');
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
  console.log(`✓ Booking order created: ${booking.id}, status: ${booking.status}, totalAmount: ${booking.totalAmount}`);
  assert(booking.status === 'pending', 'Booking status should be pending');

  console.log('\n--- Step 5: Checkout Booking Using Coins ---');
  const coinsCheckoutRes = await request<ApiSuccess<any>>('/consumer/checkout/coins', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken),
    body: JSON.stringify({ bookingOrderId: booking.id })
  });
  const coinsCheckoutResult = extractSuccess(coinsCheckoutRes, 'checkout with coins');
  console.log(`✓ Coins checkout: success=${coinsCheckoutResult.success}, remainingBalance=${coinsCheckoutResult.balance}`);
  assert(coinsCheckoutResult.success === true, 'Checkout should be successful');

  const expectedRemaining = 5000 - parseFloat(booking.totalAmount);
  assert(parseFloat(coinsCheckoutResult.balance) === expectedRemaining, `Expected remaining balance to be ${expectedRemaining} but got ${coinsCheckoutResult.balance}`);

  console.log('\n--- Step 6: Verify Booking status becomes Paid ---');
  const fetchBookingRes = await request<ApiSuccess<any>>(`/booking-orders/${booking.orderNumber}`, {
    headers: authHeaders(customer.tokens.accessToken, tenant.slug)
  });
  const updatedBooking = extractSuccess(fetchBookingRes, 'fetch updated booking');
  assert(updatedBooking.status === 'paid', 'Expected booking order status to be paid');
  console.log(`✓ Booking status is paid, confirm tickets list: ${updatedBooking.tickets?.length} tickets`);

  console.log('\n--- Step 7: Request Instant Refund to Wallet ---');
  const refundRes = await request<ApiSuccess<any>>('/consumer/refunds', {
    method: 'POST',
    headers: authHeaders(customer.tokens.accessToken),
    body: JSON.stringify({
      bookingId: booking.id,
      reason: 'Change of plans',
      refundTo: 'wallet'
    })
  });
  const refundResult = extractSuccess(refundRes, 'request instant refund');
  console.log(`✓ Refund status: ${refundResult.status}, type: ${refundResult.type}`);
  assert(refundResult.status === 'processed', 'Refund should be processed instantly');

  console.log('\n--- Step 8: Verify Wallet Balance Restored ---');
  const finalWalletRes = await request<ApiSuccess<any>>('/consumer/wallet', {
    headers: authHeaders(customer.tokens.accessToken)
  });
  const finalWallet = extractSuccess(finalWalletRes, 'get final wallet');
  console.log(`✓ Final balance: ${finalWallet.wallet.balance}`);
  assert(parseFloat(finalWallet.wallet.balance) === 5000, 'Balance should be restored back to 5000');

  console.log('\n--- Step 9: Verify Booking status becomes Refunded ---');
  const checkBookingRes = await request<ApiSuccess<any>>(`/booking-orders/${booking.orderNumber}`, {
    headers: authHeaders(customer.tokens.accessToken, tenant.slug)
  });
  const finalBooking = extractSuccess(checkBookingRes, 'fetch final booking');
  assert(finalBooking.status === 'refunded', 'Expected booking status to be refunded');
  console.log(`✓ Final booking status: ${finalBooking.status}`);

  console.log('\nALL COINS & REFUNDS SMOKE TESTS PASSED SUCCESSFULLY! 🎉');
}

run().catch((err) => {
  console.error('❌ Smoke test failed:', err);
  process.exit(1);
});
