import { eq, sql, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ledgerTransactions, ledgerAccounts, ledgerEntries, organizerWallets, ledgerAccountBalances } from '../db/schema/ledger.js';
import { paymentDisputes, promotions, bookingOrders, paymentTransactions } from '../db/schema/payments.js';
import { events } from '../db/schema/events.js';
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
      fullName: `Finance Enterprise User ${username}`,
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
    body: JSON.stringify({ name, description: 'Finance Enterprise testing tenant' })
  });
  return extractSuccess(response, `create tenant ${name}`);
}

async function run() {
  console.log('============================================================');
  console.log('ENTERPRISE FINANCE SMOKE TESTS STARTING...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('============================================================');

  const stamp = Date.now();
  const owner = await signup(`fin_ent_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Finance Ent Tenant ${stamp}`);
  const headers = authHeaders(owner.tokens.accessToken, tenant.slug);

  // Setup event and booking context
  console.log('\n--- Seeding Organizer, Venue, Event and Booking pass ---');
  // Create Organizer
  const organizerRes = await request<ApiSuccess<any>>('/organizers', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Ent Vibe Org',
      displayName: 'Ent Vibe',
      slug: `ent-vibe-org-${stamp}`,
      description: 'Enterprise event organizer',
      supportEmail: 'support@entvibe.com',
      verificationStatus: 'verified'
    })
  });
  const organizer = extractSuccess(organizerRes, 'Create organizer');
  await db.execute(sql`UPDATE organizers SET verification_status = 'verified' WHERE id = ${organizer.id}`);

  // Create Venue
  const venueRes = await request<ApiSuccess<any>>('/venues', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Ent Vibe Arena',
      addressLine1: 'Main Ring Road',
      city: 'Delhi',
      state: 'Delhi',
      country: 'India',
      capacity: 5000
    })
  });
  const venue = extractSuccess(venueRes, 'Create venue');

  // Create Event
  const eventRes = await request<ApiSuccess<any>>('/events', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Global Enterprise Expo',
      shortDescription: 'Enterprise Fintech showcase',
      description: 'Fintech and AI platform event',
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
      name: 'Gold Pass',
      price: 1000,
      totalQuantity: 200,
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

  // Create Booking Order
  const bookingRes = await request<ApiSuccess<any>>('/booking-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: ticket.id, quantity: 1 }] // 1000 price
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

  // Capture payment via verify
  const razorpayPaymentId = `pay_mock_fin_ent_${Date.now()}`;
  const crypto = await import('node:crypto');
  const hmacSecret = env.RAZORPAY_MODE === 'test' ? env.RAZORPAY_SECRET_KEY : env.RAZORPAY_KEY_SECRET;
  const signature = crypto.createHmac('sha256', hmacSecret)
    .update(`${rzpOrder.orderId}|${razorpayPaymentId}`)
    .digest('hex');

  const verifyRes = await request<ApiSuccess<any>>('/payments/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      razorpayOrderId: rzpOrder.orderId,
      razorpayPaymentId,
      razorpaySignature: signature,
      reservationId: rzpOrder.notes?.reservationIds,
      reservationToken: rzpOrder.notes?.reservationTokens
    })
  });
  assert(verifyRes.status === 200, 'Verify payment signature endpoint failed');
  console.log('✓ Captured payment successfully and generated initial ledger entries.');

  // Fetch the created payment transaction to get its ID
  const [dbTxRecord] = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.razorpayPaymentId, razorpayPaymentId))
    .limit(1);

  assert(dbTxRecord, 'Payment transaction record must exist in DB');

  // Let's mark the event as completed so that the booking order is eligible for settlement.
  await db.execute(sql`UPDATE events SET status = 'completed' WHERE id = ${event.id}`);

  // Let's seed organizer balance so there is available balance to place holds
  // (During a normal flow, capture places funds in Platform Escrow. Let's run a settlement generate and approve run so funds move to organizer available!)
  console.log('\n--- 1. Settling funds to organizer available balance ---');
  const genSettlementRes = await request<ApiSuccess<any>>('/admin/settlements/generate', { method: 'POST', headers });
  const settlementRun = extractSuccess(genSettlementRes, 'Generate settlement');
  
  const approveSettlementRes = await request<ApiSuccess<any>>(`/admin/settlements/${settlementRun.id}/approve`, { method: 'POST', headers });
  assert(approveSettlementRes.status === 200, 'Approve settlement run failed');
  console.log('✓ Settlement run approved. Funds shifted to Organizer Available balance.');

  // 1. Test Chargebacks & Disputes
  console.log('\n--- 2. Testing Disputes Subsystem via webhook & resolutions ---');
  const razorpayDisputeId = `disp_test_${stamp}`;
  
  // Simulate dispute webhook
  const webhookUrl = `${BASE_URL}/payments/webhooks/razorpay`;
  const webhookBody = {
    id: `evt_disp_${stamp}`,
    event: 'dispute.created',
    payload: {
      dispute: {
        entity: {
          id: razorpayDisputeId,
          payment_id: razorpayPaymentId,
          amount: 50000, // 500.00 INR dispute
          currency: 'INR',
          reason: 'fraudulent',
          status: 'open',
          evidence_deadline: Math.floor(Date.now() / 1000) + 86400
        }
      }
    }
  };

  const webhookSignature = crypto.createHmac('sha256', hmacSecret)
    .update(JSON.stringify(webhookBody))
    .digest('hex');

  const webhookRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': webhookSignature
    },
    body: JSON.stringify(webhookBody)
  });

  assert(webhookRes.status === 200, 'Dispute webhook handling failed');
  console.log('✓ Webhook dispute.created processed.');

  // Check if dispute record exists
  const [disputeRecord] = await db
    .select()
    .from(paymentDisputes)
    .where(eq(paymentDisputes.razorpayDisputeId, razorpayDisputeId))
    .limit(1);

  assert(disputeRecord, 'Dispute record must exist in DB');
  assert(disputeRecord.status === 'received', 'Initial dispute status should be received');

  // Verify chargeback hold posted in ledger (ORGANIZER_AVAILABLE debited, CHARGEBACK_RESERVE credited)
  const [holdTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'payment_dispute'), eq(ledgerTransactions.referenceId, disputeRecord.id)))
    .limit(1);

  assert(holdTx, 'Ledger transaction for dispute hold must be created');
  console.log('✓ Dispute hold ledger entries verified.');

  // Test evidence upload
  console.log('--- Evidence upload ---');
  const evidenceRes = await request<ApiSuccess<any>>(`/admin/disputes/${disputeRecord.id}/evidence`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      documentUrl: 'https://example.com/receipt.pdf',
      documentType: 'refund_receipt'
    })
  });
  const evidence = extractSuccess(evidenceRes, 'Upload evidence');
  assert(evidence.documentUrl === 'https://example.com/receipt.pdf', 'Uploaded document URL mismatch');

  const [disputeAfterEvidence] = await db
    .select()
    .from(paymentDisputes)
    .where(eq(paymentDisputes.id, disputeRecord.id))
    .limit(1);
  assert(disputeAfterEvidence.status === 'evidence_submitted', 'Dispute status should be evidence_submitted');
  console.log('✓ Dispute evidence uploaded successfully.');

  // Resolve won
  console.log('--- Dispute won resolution ---');
  const resolveWonRes = await request<ApiSuccess<any>>(`/admin/disputes/${disputeRecord.id}/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ resolution: 'won' })
  });
  const disputeResolvedWon = extractSuccess(resolveWonRes, 'Resolve dispute won');
  assert(disputeResolvedWon.status === 'won', 'Dispute status should be won');

  const [wonTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'payment_dispute'), eq(ledgerTransactions.referenceId, disputeRecord.id), eq(ledgerTransactions.transactionType, 'CHARGEBACK_WON')))
    .limit(1);
  assert(wonTx, 'Dispute won release ledger transaction must be created');
  console.log('✓ Dispute won resolution and hold release verified.');

  // Test lost dispute hold & resolution
  console.log('--- Dispute lost resolution ---');
  const dispute2Payload = {
    id: `evt_disp_lost_${stamp}`,
    event: 'dispute.created',
    payload: {
      dispute: {
        entity: {
          id: `disp_lost_${stamp}`,
          payment_id: razorpayPaymentId,
          amount: 20000, // 200.00 INR
          currency: 'INR',
          reason: 'fraudulent',
          status: 'open'
        }
      }
    }
  };
  const webhookSignature2 = crypto.createHmac('sha256', hmacSecret)
    .update(JSON.stringify(dispute2Payload))
    .digest('hex');

  await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': webhookSignature2
    },
    body: JSON.stringify(dispute2Payload)
  });

  const [disputeRecord2] = await db
    .select()
    .from(paymentDisputes)
    .where(eq(paymentDisputes.razorpayDisputeId, `disp_lost_${stamp}`))
    .limit(1);

  const resolveLostRes = await request<ApiSuccess<any>>(`/admin/disputes/${disputeRecord2.id}/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ resolution: 'lost' })
  });
  const disputeResolvedLost = extractSuccess(resolveLostRes, 'Resolve dispute lost');
  assert(disputeResolvedLost.status === 'lost', 'Dispute status should be lost');

  const [lostTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'payment_dispute'), eq(ledgerTransactions.referenceId, disputeRecord2.id), eq(ledgerTransactions.transactionType, 'CHARGEBACK_LOST')))
    .limit(1);
  assert(lostTx, 'Dispute lost release ledger transaction must be created');
  console.log('✓ Dispute lost resolution and final clearing expense verified.');

  // 2. Test Promotions & Coupon Accounting
  console.log('\n--- 3. Testing Promotions & Coupon accounting ---');
  const promoCode = `PROMO_${stamp}`;
  const createPromoRes = await request<ApiSuccess<any>>('/admin/promotions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: promoCode,
      type: 'coupon',
      amount: 150.00, // 150 INR coupon
      currency: 'INR'
    })
  });
  const promo = extractSuccess(createPromoRes, 'Create promotion');
  assert(promo.code === promoCode, 'Promo code mismatch');

  const listPromosRes = await request<ApiSuccess<any[]>>('/admin/promotions', { headers });
  const promosList = extractSuccess(listPromosRes, 'List promotions');
  assert(promosList.length >= 1, 'Expected promotions list to be populated');
  console.log('✓ Coupon promotion registered and listed successfully.');

  // Apply promotional credit
  const applyPromoRes = await request<ApiSuccess<any>>('/admin/promotions/apply', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: owner.user.id,
      amount: 15000, // 150.00 INR in minor units
      currency: 'INR',
      idempotencyKey: `promo:apply:${stamp}`
    })
  });
  assert(applyPromoRes.status === 201, 'Apply promotional credit endpoint failed');

  // Verify ledger postings (SYSTEM_ADJUSTMENT -> CUSTOMER_LIABILITY)
  const [promoCreditTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'customer'), eq(ledgerTransactions.referenceId, owner.user.id), eq(ledgerTransactions.transactionType, 'PROMOTION_CREDIT')))
    .limit(1);
  assert(promoCreditTx, 'Promotional credit ledger posting should exist');
  console.log('✓ Promotional credit applied and double-entry verified.');

  // Reverse promotional credit
  const reversePromoRes = await request<ApiSuccess<any>>('/admin/promotions/reverse', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: owner.user.id,
      amount: 15000, // 150.00 INR
      currency: 'INR',
      idempotencyKey: `promo:reverse:${stamp}`
    })
  });
  assert(reversePromoRes.status === 201, 'Reverse promotional credit endpoint failed');

  const [promoReverseTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'customer'), eq(ledgerTransactions.referenceId, owner.user.id), eq(ledgerTransactions.transactionType, 'PROMOTION_REVERSAL')))
    .limit(1);
  assert(promoReverseTx, 'Promotional reversal ledger posting should exist');
  console.log('✓ Promotional credit reversed and double-entry verified.');

  // 3. Test Booking upgrades, downgrades and reschedules
  console.log('\n--- 4. Testing Ticket Adjustments: Upgrades, Downgrades & Rescheduling ---');
  
  // Create another booking for upgrades/downgrades
  const booking2Res = await request<ApiSuccess<any>>('/booking-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      eventId: event.id,
      purchaserUserId: owner.user.id,
      status: 'pending',
      source: 'web',
      items: [{ ticketTypeId: ticket.id, quantity: 1 }]
    })
  });
  const booking2 = extractSuccess(booking2Res, 'Create booking order 2');

  // Upgrade
  console.log('--- Booking Upgrade ---');
  const upgradeRes = await request<ApiSuccess<any>>(`/admin/bookings/${booking2.id}/upgrade`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amountDiff: 30000, // 300 INR difference
      idempotencyKey: `upgrade:${booking2.id}:${stamp}`
    })
  });
  const upgradeData = extractSuccess(upgradeRes, 'Upgrade booking');
  assert(Number(upgradeData.newTotal) === 1300.00, 'Upgraded total mismatch');

  const [upgradeTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'booking_order'), eq(ledgerTransactions.referenceId, booking2.id), eq(ledgerTransactions.transactionType, 'BOOKING_UPGRADE')))
    .limit(1);
  assert(upgradeTx, 'Booking upgrade ledger posting must exist');
  console.log('✓ Booking upgrade and ledger adjustment verified.');

  // Downgrade
  console.log('--- Booking Downgrade ---');
  const downgradeRes = await request<ApiSuccess<any>>(`/admin/bookings/${booking2.id}/downgrade`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amountDiff: 20000, // 200 INR diff
      idempotencyKey: `downgrade:${booking2.id}:${stamp}`
    })
  });
  const downgradeData = extractSuccess(downgradeRes, 'Downgrade booking');
  assert(Number(downgradeData.newTotal) === 1100.00, 'Downgraded total mismatch');

  const [downgradeTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'booking_order'), eq(ledgerTransactions.referenceId, booking2.id), eq(ledgerTransactions.transactionType, 'BOOKING_DOWNGRADE')))
    .limit(1);
  assert(downgradeTx, 'Booking downgrade ledger posting must exist');
  console.log('✓ Booking downgrade and ledger adjustment verified.');

  // Reschedule
  console.log('--- Booking Reschedule ---');
  const rescheduleRes = await request<ApiSuccess<any>>(`/admin/bookings/${booking2.id}/reschedule`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      changeFee: 5000, // 50.00 INR fee
      idempotencyKey: `reschedule:${booking2.id}:${stamp}`
    })
  });
  const rescheduleData = extractSuccess(rescheduleRes, 'Reschedule booking');
  assert(rescheduleData.changeFee === 5000, 'Change fee mismatch');

  const [rescheduleTx] = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.referenceType, 'booking_order'), eq(ledgerTransactions.referenceId, booking2.id), eq(ledgerTransactions.transactionType, 'BOOKING_RESCHEDULE_FEE')))
    .limit(1);
  assert(rescheduleTx, 'Reschedule fee ledger posting must exist');
  console.log('✓ Booking rescheduling fee ledger entry verified.');

  // Let's manually credit some extra funds (e.g. 500.00 INR) to the organizer's wallet so they have enough balance to cover the lost dispute and refund.
  console.log('\n--- Manual credit to organizer wallet ---');
  const creditRes = await request<ApiSuccess<any>>('/finance/operations/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operationType: 'manual_credit',
      amount: 50000, // 500.00 INR
      currency: 'INR',
      referenceType: 'adjustment',
      referenceId: `adj_credit_${stamp}`,
      idempotencyKey: `manual_credit_pre_cancel_${stamp}`,
      organizerId: organizer.id,
      reason: 'Seed balance to cover lost dispute'
    })
  });
  assert(creditRes.status === 201, 'Manual credit failed');
  console.log('✓ Manual credit of 500.00 INR succeeded.');

  // Recalculate/rebuild the organizer wallet available balance projection from ledger entries
  console.log('--- Recalculate organizer wallet ---');
  const recalcRes = await request<ApiSuccess<any>>(`/finance/wallets/${organizer.id}/recalculate`, {
    method: 'POST',
    headers
  });
  assert(recalcRes.status === 200, 'Recalculate organizer wallet failed');
  console.log('✓ Organizer wallet balances recalculated successfully.');

  // 4. Test Event Cancellation (Refunds loop and ledger reversals)
  console.log('\n--- 5. Testing Event Cancellation & Auto-Refund payouts ---');
  const cancelEventRes = await request<ApiSuccess<any>>(`/admin/events/${event.id}/cancel`, {
    method: 'POST',
    headers
  });
  const cancelResult = extractSuccess(cancelEventRes, 'Cancel event');
  assert(cancelResult.refundResults.length >= 1, 'Expected at least 1 booking order refunded');
  assert(cancelResult.refundResults[0].success === true, 'Event cancellation refund failed');

  const [eventAfterCancel] = await db
    .select()
    .from(events)
    .where(eq(events.id, event.id))
    .limit(1);
  assert(eventAfterCancel.status === 'cancelled', 'Event status must be cancelled');
  console.log('✓ Event cancellation successfully executed with automatic booking refunds.');

  // 5. Test Negative Balance Protection Invariant
  console.log('\n--- 6. Verifying Negative Balance Protection constraint ---');
  // Attempt to execute a manual debit that exceeds available organizer balance
  const orgWallet = await db
    .select()
    .from(organizerWallets)
    .where(eq(organizerWallets.organizerId, organizer.id))
    .limit(1)
    .then(res => res[0] ?? null);

  const walletBalanceMinor = orgWallet ? Math.round(parseFloat(orgWallet.availableBalance) * 100) : 0;
  console.log(`Current Organizer Available Balance: ${walletBalanceMinor/100} INR.`);

  // Attempt to debit walletBalanceMinor + 50000 (exceeds balance)
  const badDebitRes = await request<ApiSuccess<any>>('/finance/operations/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operationType: 'manual_debit',
      amount: walletBalanceMinor + 50000,
      currency: 'INR',
      referenceType: 'adjustment',
      referenceId: `adj_${stamp}`,
      idempotencyKey: `bad_debit_${stamp}`,
      organizerId: organizer.id,
      reason: 'Illegal debit test'
    })
  });

  // Verify it failed because of negative balance constraint
  assert(badDebitRes.status >= 400, 'Expected manual debit to fail due to negative balance protection');
  assert(badDebitRes.raw.includes('Insufficient funds') || badDebitRes.raw.includes('below zero'), 'Expected insufficient funds validation error message');
  console.log('✓ Negative balance protection successfully blocked invalid overdraft debit transaction!');

  // 6. Test final Trial Balance health check
  console.log('\n--- 7. Verifying Trial Balance integrity check ---');
  const finalTrialRes = await request<ApiSuccess<any>>('/finance/trial-balance', { headers });
  const finalTrial = extractSuccess(finalTrialRes, 'Final Trial balance');
  assert(finalTrial.balanced === true, 'General ledger must remain fully balanced after all operations');
  console.log(`✓ Final Trial Balance verification passed! Total Debits == Total Credits (${finalTrial.totalDebits} INR).`);

  console.log('\n============================================================');
  console.log('ALL Revelis Enterprise Finance Smoke Tests PASSED successfully!');
  console.log('============================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ ENTERPRISE FINANCE SMOKE TEST FAILED:\n');
  console.error(err);
  process.exit(1);
});
