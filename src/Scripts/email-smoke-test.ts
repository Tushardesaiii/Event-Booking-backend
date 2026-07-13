import { createHmac, randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import {
  emailDeliveries,
  emailPreferences,
  emailSuppressions,
  emailBounces,
  emailComplaints,
  emailCampaigns,
  tenants,
  users,
  authAccounts
} from '../db/schema/index.js';
import { emailClient } from '../lib/email-client.js';

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

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof URLSearchParams) && !(body instanceof FormData)) {
    body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    body,
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

async function signup(username: string) {
  const phoneSuffix = Math.floor(1000 + Math.random() * 9000);
  const startResponse = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `User ${username}`,
      username,
      email: `${username}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: `+91999901${phoneSuffix}`
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
    body: JSON.stringify({ name, description: 'Email Test Tenant' })
  });
  return extractSuccess(response, `create tenant ${name}`);
}

async function run() {
  console.log('============================================================');
  console.log('ENTERPRISE BREVO EMAIL SMOKE TESTS STARTING...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('============================================================');

  const stamp = Date.now();
  const owner = await signup(`email_owner_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Email Tenant ${stamp}`);

  console.log(`✓ Created User ${owner.user.id} and Tenant ${tenant.id}`);

  // 1. VERIFY DEFAULT PREFERENCES CREATION
  console.log('\n--- 1. Verification of default preferences creation ---');
  const getPrefsRes = await request<ApiSuccess<any>>('/email/preferences', {
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  const prefs = extractSuccess(getPrefsRes, 'Get default preferences');
  assert(prefs.marketing === true, 'Default marketing preference should be true');
  assert(prefs.campaign === true, 'Default campaign preference should be true');
  assert(prefs.notification === true, 'Default notification preference should be true');
  assert(!!prefs.unsubscribeToken, 'Unsubscribe token should be generated');
  console.log(`✓ Default preferences successfully generated: token=${prefs.unsubscribeToken}`);

  // 2. TRANSACTIONAL ENQUEUEING
  console.log('\n--- 2. Transactional outbox enqueueing ---');
  const recipient = `test_recipient_${stamp}@example.com`;
  const deliveryId = await emailClient.enqueue({
    tenantId: tenant.id,
    userId: owner.user.id,
    recipientEmail: recipient,
    subject: 'Confirm your sign up - Smoke Test',
    htmlContent: '<p>Verify code: 654321</p>',
    category: 'transactional'
  });

  assert(!!deliveryId && deliveryId !== 'skipped_unsubscribed' && deliveryId !== 'skipped_suppressed', 'Enqueue should return delivery ID');
  console.log(`✓ Transactional email enqueued in DB outbox. Delivery ID: ${deliveryId}`);

  // Direct DB verification
  const [dbDelivery] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, deliveryId));
  assert(dbDelivery, 'Delivery record should exist in DB');
  assert(dbDelivery.status === 'pending', `Status should be pending, got ${dbDelivery.status}`);
  assert(dbDelivery.category === 'transactional', 'Category should be transactional');
  console.log(`✓ Verified pending state in email_deliveries table directly.`);

  // 3. QSTASH JOB WORKER SIMULATION
  console.log('\n--- 3. QStash Job Worker execution simulation ---');
  const workerRes = await request<ApiSuccess<any>>('/qstash/jobs', {
    method: 'POST',
    body: {
      jobType: 'process_delivery',
      data: { deliveryId }
    }
  });
  expectStatus(workerRes, [200], 'QStash delivery execution');
  console.log('✓ Manual QStash process_delivery job processed by server route.');

  // Check outbox record status - since BREVO_API_KEY might be invalid/dummy in local tests, status should transition to failed or delivered, but not pending
  const [dbDeliveryAfter] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, deliveryId));
  assert(dbDeliveryAfter.status !== 'pending', `Delivery status should have changed. Got: ${dbDeliveryAfter.status}, lastError: ${dbDeliveryAfter.lastError}`);
  console.log(`✓ Confirmed delivery status transition from pending to: '${dbDeliveryAfter.status}'`);

  // 4. PREFERENCE FILTERING & COMPLIANCE BYPASS
  console.log('\n--- 4. Preference filtering and category compliance bypass ---');
  // Update preference to opt-out from marketing
  const updatePrefsRes = await request<ApiSuccess<any>>('/email/preferences', {
    method: 'PATCH',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: { marketing: false }
  });
  const updatedPrefs = extractSuccess(updatePrefsRes, 'Update preferences');
  assert(updatedPrefs.marketing === false, 'Marketing preference should be false after opt-out');

  // Attempt to enqueue marketing email
  const marketingId = await emailClient.enqueue({
    tenantId: tenant.id,
    userId: owner.user.id,
    recipientEmail: `${owner.user.username}@example.com`,
    subject: 'Special Offer! - Smoke Test',
    htmlContent: '<p>Buy now</p>',
    category: 'marketing'
  });
  assert(marketingId === 'skipped_unsubscribed', `Marketing email should be blocked, got: ${marketingId}`);
  console.log('✓ Marketing email correctly blocked due to unsubscribe preference.');

  // Attempt to enqueue billing email (bypass!)
  const billingId = await emailClient.enqueue({
    tenantId: tenant.id,
    userId: owner.user.id,
    recipientEmail: `${owner.user.username}@example.com`,
    subject: 'Payment Successful - Smoke Test',
    htmlContent: '<p>Thank you</p>',
    category: 'billing'
  });
  assert(billingId !== 'skipped_unsubscribed' && billingId !== 'skipped_suppressed', 'Billing category email must bypass opt-outs');
  console.log(`✓ Billing email successfully bypassed opt-out. Delivery ID: ${billingId}`);

  // 5. GLOBAL SUPPRESSIONS & BYPASS
  console.log('\n--- 5. Global suppression listing and security bypass ---');
  const suppressedEmail = `suppressed_${stamp}@example.com`;
  
  // Directly insert suppression
  await db.insert(emailSuppressions).values({
    tenantId: tenant.id,
    email: suppressedEmail,
    reason: 'spam_complaint',
    scope: 'individual',
    metadata: { reason: 'test' }
  });
  console.log(`✓ Seeded global suppression for: ${suppressedEmail}`);

  // Enqueue notification category (should be blocked)
  const notificationId = await emailClient.enqueue({
    tenantId: tenant.id,
    recipientEmail: suppressedEmail,
    subject: 'Event Reminder - Smoke Test',
    htmlContent: '<p>Don’t forget</p>',
    category: 'notification'
  });
  assert(notificationId === 'skipped_suppressed', `Notification email should be suppressed, got: ${notificationId}`);
  console.log('✓ Notification category email correctly blocked due to suppression.');

  // Enqueue security category (bypass!)
  const securityId = await emailClient.enqueue({
    tenantId: tenant.id,
    recipientEmail: suppressedEmail,
    subject: 'Security Alert: Password changed - Smoke Test',
    htmlContent: '<p>Warning</p>',
    category: 'security'
  });
  assert(securityId !== 'skipped_unsubscribed' && securityId !== 'skipped_suppressed', 'Security category email must bypass suppressions');
  console.log(`✓ Security email successfully bypassed suppression. Delivery ID: ${securityId}`);

  // 6. BREVO WEBHOOK & AUTO-SUPPRESSION
  console.log('\n--- 6. Brevo Webhook processing & auto-suppression ---');
  const bounceTarget = `bounce_target_${stamp}@example.com`;
  
  const webhookPayload = {
    event: 'hard_bounce',
    email: bounceTarget,
    id: Math.floor(Math.random() * 10000000)
  };

  const webhookRes = await request<ApiSuccess<any>>('/email/webhooks/brevo', {
    method: 'POST',
    body: webhookPayload
  });
  expectStatus(webhookRes, [200], 'Brevo webhook processing');
  console.log('✓ Brevo webhook accepted hard bounce payload.');

  // Verify DB entries created by webhook
  const [suppression] = await db
    .select()
    .from(emailSuppressions)
    .where(and(eq(emailSuppressions.email, bounceTarget), eq(emailSuppressions.reason, 'hard_bounce')));
  assert(suppression, 'Webhook should automatically insert a suppression record for hard_bounce');
  
  const [bounce] = await db
    .select()
    .from(emailBounces)
    .where(eq(emailBounces.email, bounceTarget));
  assert(bounce, 'Webhook should record the bounce details in email_bounces table');
  console.log('✓ Checked email_suppressions and email_bounces tables. Auto-suppression generated successfully.');

  // 7. CAMPAIGN lifecycle, snapshotting & executes
  console.log('\n--- 7. Campaign scheduling, snapshotting, and executes ---');
  
  // Seed subscribers first to test segment criteria snapshotting
  // Let's create two subscribers
  const sub1 = `${stamp}_sub1@example.com`;
  const sub2 = `${stamp}_sub2@example.com`;
  
  await db.insert(emailPreferences).values([
    { tenantId: tenant.id, email: sub1, marketing: true, campaign: true, unsubscribeToken: `token_1_${stamp}` },
    { tenantId: tenant.id, email: sub2, marketing: true, campaign: true, unsubscribeToken: `token_2_${stamp}` }
  ]);
  console.log('✓ Registered two subscribers for campaign snapshotting.');

  const [campaign] = await db
    .insert(emailCampaigns)
    .values({
      tenantId: tenant.id,
      name: `Promo Campaign ${stamp}`,
      subject: 'Flash Sale!',
      templateKey: 'promotional-campaign',
      status: 'draft',
      variables: { promo: { title: 'Flash Sale', description: '50% off', link: 'http://example.com', ctaText: 'Buy' } },
      criteria: { criteriaType: 'all_subscribers' }, // mock segment criteria
      createdByUserId: owner.user.id
    })
    .returning();
  
  console.log(`✓ Created Campaign: id=${campaign.id}, status=${campaign.status}`);

  // Schedule campaign for 1 hour in future
  const schedTime = new Date(Date.now() + 3600 * 1000).toISOString();
  const scheduleRes = await request<ApiSuccess<any>>(`/email/campaigns/${campaign.id}/schedule`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: { scheduledAt: schedTime }
  });
  expectStatus(scheduleRes, [200], 'Schedule campaign');
  console.log('✓ Campaign scheduled successfully.');

  const [dbCampaignSched] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaign.id));
  assert(dbCampaignSched.status === 'scheduled', `Status should be scheduled, got ${dbCampaignSched.status}`);
  assert(dbCampaignSched.scheduledAt !== null, 'scheduledAt timestamp should be set');

  // Trigger Immediate Send/Execute
  const executeRes = await request<ApiSuccess<any>>(`/email/campaigns/${campaign.id}/send`, {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug)
  });
  expectStatus(executeRes, [200], 'Execute campaign now');
  console.log('✓ Campaign send execution triggered.');

  const [dbCampaignExec] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaign.id));
  assert(dbCampaignExec.status === 'sending' || dbCampaignExec.status === 'sent', `Campaign status should transition to sending/sent, got ${dbCampaignExec.status}`);
  console.log(`✓ Campaign execution status: ${dbCampaignExec.status}`);

  // 8. OBSERVABILITY DIAGNOSTICS & METRICS
  console.log('\n--- 8. Diagnostics and Prometheus metrics ---');
  const healthRes = await request<any>('/health');
  expectStatus(healthRes, [200], 'Health check');
  assert(healthRes.data?.data?.services?.email_outbox?.status === 'ok', 'Email outbox should be healthy');
  console.log('✓ Health check endpoint returns healthy diagnostics for email engine.');

  const metricsRes = await request<any>('/metrics');
  expectStatus(metricsRes, [200], 'Metrics endpoint');
  assert(metricsRes.raw.includes('emails_sent_total') || metricsRes.raw.includes('emails_queued_total'), 'Prometheus metrics must export email counts');
  console.log('✓ Prometheus metrics check passed successfully.');

  console.log('\n============================================================');
  console.log('ALL ENTERPRISE BREVO EMAIL MODULE SMOKE TESTS PASSED!');
  console.log('============================================================');
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ EMAIL MODULE SMOKE TEST FAILED\n');
    console.error(err);
    process.exit(1);
  });

