import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { otpVerifications } from '../db/schema/otp-verifications.js';
import { emailVerificationTokens } from '../db/schema/email-verification-tokens.js';
import { marketingSubscribers } from '../db/schema/marketing-subscribers.js';
import { emailSuppressions } from '../db/schema/email-suppressions.js';
import { verificationEvents } from '../db/schema/verification-events.js';
import { users } from '../db/schema/users.js';
import { authAccounts } from '../db/schema/auth-accounts.js';
import { tenants } from '../db/schema/tenants.js';
import { marketingCampaigns } from '../db/schema/marketing-campaigns.js';
import { marketingCampaignDeliveries } from '../db/schema/marketing-campaign-deliveries.js';
import { verifyJwt } from '../lib/jwt.js';
import { env } from '../config/env.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
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
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}


function section(title: string) {
  console.log('\n============================================================');
  console.log(title);
  console.log('============================================================\n');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headersToObject(headers?: HeadersInit) {
  return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headersToObject(options.headers)
    },
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
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

function expectErrorCode(result: RequestResult<unknown>, code: string, label: string) {
  const payload = result.data as ApiError | null;
  assert(payload?.error?.code === code, `${label} expected ${code}`, result.data ?? result.raw);
}

async function run() {
  section('EMAIL VERIFICATION & OTP INFRASTRUCTURE SMOKE TEST');

  const ts = Date.now();
  const testEmail = `verify_smoke_${ts}@example.com`;
  const testPhone = `+155500${String(ts).slice(-5)}`;
  const tenantSlug = `tenant-${ts}`;

  let tenantId = '';
  let tenantSlugReal = '';
  let ownerToken = '';
  let ownerUserId = '';

  // Step 1: Health check
  section('1) Health check');
  const health = await request<{ status: string }>('/health');
  expectStatus(health, [200], 'health check');

  // Step 2: Signup a test user to perform protected tenant and campaign actions
  section('2) Owner signup & login');
  const signupStart = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup', {
    method: 'POST',
    body: {
      fullName: 'Auth Owner',
      username: `owner_${ts}`,
      email: `owner_${ts}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: `+155555${String(ts).slice(-5)}`,
      marketingOptIn: true
    }
  });
  expectStatus(signupStart, [201], 'owner signup start');
  const { verificationSessionId } = extractSuccess(signupStart, 'owner signup start');

  const signupVerify = await request<ApiSuccess<any>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });
  expectStatus(signupVerify, [201], 'owner signup verify');
  const signupData = extractSuccess(signupVerify, 'owner signup verify');

  ownerToken = signupData.tokens.accessToken;
  ownerUserId = signupData.user.id;

  // Let's verify that the owner's user record has marketingOptIn set to true
  const ownerUserRow = await db.query.users.findFirst({
    where: eq(users.id, ownerUserId)
  });
  assert(ownerUserRow?.marketingOptIn === true, 'Owner marketingOptIn should be true');

  // Let's verify the user auto-subscribed to the newsletter (tenantId is null for global)
  const globalSubscriber = await db.query.marketingSubscribers.findFirst({
    where: eq(marketingSubscribers.email, `owner_${ts}@example.com`)
  });
  assert(!!globalSubscriber, 'User should be auto-subscribed globally during registration');
  assert(globalSubscriber.source === 'user_registration', 'Subscriber source should be user_registration');

  // Create a Tenant for campaigns
  const createTenantRes = await request<ApiSuccess<any>>('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: {
      name: `Smoke Tenant ${ts}`,
      description: 'Smoke test tenant'
    }
  });
  expectStatus(createTenantRes, [201], 'create tenant');
  const tenantData = extractSuccess(createTenantRes, 'create tenant');
  tenantId = tenantData.id;
  tenantSlugReal = tenantData.slug;

  // Step 3: OTP Send & Verify with Bypass Mode
  section('3) OTP Flow in Bypass Mode');
  const correlationId1 = `corr-otp-${ts}`;
  const sendOtpRes = await request<ApiSuccess<any>>('/auth/send-otp', {
    method: 'POST',
    headers: {
      'x-correlation-id': correlationId1,
      'x-tenant-slug': tenantSlugReal
    },
    body: {
      phoneNumber: testPhone,
      purpose: 'signup'
    }
  });
  expectStatus(sendOtpRes, [200], 'send otp');

  // Verify that an OTP record was written in the database
  const otpRecord = await db.query.otpVerifications.findFirst({
    where: eq(otpVerifications.phoneNumber, testPhone),
    orderBy: (rec, { desc }) => [desc(rec.createdAt)]
  });
  assert(!!otpRecord, 'OTP record should be written in DB');
  assert(otpRecord.verifiedAt === null, 'OTP verifiedAt should initially be null');

  // Verify that a verification event log was written for send
  const verifyEventSend = await db.query.verificationEvents.findFirst({
    where: and(
      eq(verificationEvents.phoneNumber, testPhone),
      eq(verificationEvents.eventType, 'sent')
    )
  });
  assert(!!verifyEventSend, 'OTP send event audit log should be written');
  assert(verifyEventSend.correlationId === correlationId1, 'Correlation ID should match');

  // Verify OTP with bypass code (invalid code)
  const verifyOtpRes = await request<ApiSuccess<any>>('/auth/verify-otp', {
    method: 'POST',
    headers: {
      'x-correlation-id': correlationId1,
      'x-tenant-slug': tenantSlugReal
    },
    body: {
      phoneNumber: testPhone,
      purpose: 'signup',
      code: '000000' // Invalid code, but bypass is active
    }
  });
  expectStatus(verifyOtpRes, [200], 'verify otp with bypass');

  // Check database that OTP is now marked as verified
  const otpRecordVerified = await db.query.otpVerifications.findFirst({
    where: eq(otpVerifications.phoneNumber, testPhone),
    orderBy: (rec, { desc }) => [desc(rec.createdAt)]
  });
  assert(otpRecordVerified?.verifiedAt !== null, 'OTP should be marked verified in DB');

  // Step 4: Multi-Dimensional Rate Limiting (OTP per phone/IP)
  section('4) Multi-Dimensional Rate Limiting (OTP)');
  const rlPhone = `+155599${String(ts).slice(-5)}`;
  // Let's call send-otp 6 times (max allowed per hour is 5)
  for (let i = 1; i <= 5; i++) {
    const res = await request<ApiSuccess<any>>('/auth/send-otp', {
      method: 'POST',
      body: {
        phoneNumber: rlPhone,
        purpose: 'signup'
      }
    });
    expectStatus(res, [200], `send otp rl run ${i}`);
  }
  // The 6th time must return 429
  const sendOtpRlRes = await request<ApiError>('/auth/send-otp', {
    method: 'POST',
    body: {
      phoneNumber: rlPhone,
      purpose: 'signup'
    }
  });
  expectStatus(sendOtpRlRes, [429], 'send otp rate limited');
  expectErrorCode(sendOtpRlRes, 'RATE_LIMITED', 'rate limited');

  // Verify a rate limit violation was logged to verification_events
  const rlViolationLog = await db.query.verificationEvents.findFirst({
    where: and(
      eq(verificationEvents.phoneNumber, rlPhone),
      eq(verificationEvents.eventType, 'rate_limit_violation')
    )
  });
  assert(!!rlViolationLog, 'Rate limit violation audit log should be written');

  // Step 5: Email Verification Bypass Mode
  section('5) Email Verification in Bypass Mode');
  const correlationId2 = `corr-email-${ts}`;
  const sendEmailRes = await request<ApiSuccess<any>>('/auth/send-email-verification', {
    method: 'POST',
    headers: {
      'x-correlation-id': correlationId2,
      'x-tenant-slug': tenantSlugReal
    },
    body: {
      email: testEmail
    }
  });
  expectStatus(sendEmailRes, [200], 'send email verification');

  // Verify that a token record was written in the database (since owner already exists)
  // Wait, sendEmailVerification only sends if the user exists. Let's register a user with email testEmail first.
  const emailUserIdentity = {
    fullName: 'Email Test User',
    username: `emailuser_${ts}`,
    email: testEmail,
    password: 'StrongPassword123!',
    phoneNumber: `+155577${String(ts).slice(-5)}`,
    marketingOptIn: false
  };

  const emailUserSignupStart = await request<ApiSuccess<{ verificationSessionId: string }>>('/auth/signup', {
    method: 'POST',
    body: emailUserIdentity
  });
  expectStatus(emailUserSignupStart, [201], 'email user signup start');
  const { verificationSessionId: emailUserSessId } = extractSuccess(emailUserSignupStart, 'email user signup start');

  const emailUserSignupVerify = await request<ApiSuccess<any>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId: emailUserSessId,
      code: '123456'
    }
  });
  expectStatus(emailUserSignupVerify, [201], 'email user signup verify');
  const emailUserData = extractSuccess(emailUserSignupVerify, 'email user signup verify');
  const emailUserToken = emailUserData.tokens.accessToken;
  const emailUserId = emailUserData.user.id;

  // Now, call send email verification
  const sendEmailResReal = await request<ApiSuccess<any>>('/auth/send-email-verification', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${emailUserToken}`,
      'x-correlation-id': correlationId2,
      'x-tenant-slug': tenantSlugReal
    },
    body: {
      email: testEmail
    }
  });
  expectStatus(sendEmailResReal, [200], 'send email verification');

  const tokenRecord = await db.query.emailVerificationTokens.findFirst({
    where: eq(emailVerificationTokens.userId, emailUserId),
    orderBy: (rec, { desc }) => [desc(rec.createdAt)]
  });
  assert(!!tokenRecord, 'Token record should exist in DB');

  // Verify email verification with bypass
  const verifyEmailRes = await request<ApiSuccess<any>>('/auth/verify-email', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${emailUserToken}`,
      'x-correlation-id': correlationId2,
      'x-tenant-slug': tenantSlugReal
    },
    body: {
      token: 'ANY_TOKEN_BYPASS'
    }
  });
  expectStatus(verifyEmailRes, [200], 'verify email');

  // Verify that the user is marked as verified in the DB
  const verifiedUserRow = await db.query.users.findFirst({
    where: eq(users.id, emailUserId)
  });
  assert(verifiedUserRow?.emailVerifiedAt !== null, 'User should be marked verified in DB');

  // Step 6: Request Idempotency Deduplication
  section('6) Request Idempotency');
  const idempotencyKey = `idemp-${ts}`;
  const idempPayload = {
    phoneNumber: `+155544${String(ts).slice(-5)}`,
    purpose: 'signup'
  };

  // First Request
  const idempRes1 = await request<ApiSuccess<any>>('/auth/send-otp', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: idempPayload
  });
  expectStatus(idempRes1, [200], 'first idempotency request');
  const data1 = extractSuccess(idempRes1, 'first idempotency request');

  // Second Request with same key
  const idempRes2 = await request<ApiSuccess<any>>('/auth/send-otp', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: idempPayload
  });
  expectStatus(idempRes2, [200], 'second idempotency request');
  const data2 = extractSuccess(idempRes2, 'second idempotency request');

  assert(deepEqual(data1, data2), 'Idempotent responses should be identical', { data1, data2 });

  // Verify that no extra otp_verifications record was created
  const otpCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(otpVerifications)
    .where(eq(otpVerifications.phoneNumber, idempPayload.phoneNumber));
  assert(Number(otpCount[0]?.count ?? 0) === 1, 'Should only create exactly one OTP record');

  // Step 7: Marketing Subscriber Operations
  section('7) Marketing Subscribers CRUD');
  const subscriberEmail = `sub_${ts}@example.com`;
  const subscribeRes = await request<ApiSuccess<any>>('/marketing/subscribers', {
    method: 'POST',
    headers: { 'x-tenant-slug': tenantSlugReal },
    body: {
      email: subscriberEmail,
      firstName: 'Jane',
      lastName: 'Doe',
      source: 'smoke_test'
    }
  });
  expectStatus(subscribeRes, [201], 'subscribe public');

  // List subscribers (protected)
  const listSubsRes = await request<ApiSuccess<any>>(`/marketing/subscribers?limit=10`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-tenant-slug': tenantSlugReal
    }
  });
  expectStatus(listSubsRes, [200], 'list subscribers');
  const subsList = extractSuccess(listSubsRes as any, 'list subscribers');
  assert(subsList.some((s: any) => s.email === subscriberEmail), 'Subscribed email should be in subscriber list');

  // Unsubscribe
  const unsubscribeRes = await request<ApiSuccess<any>>('/marketing/unsubscribe', {
    method: 'POST',
    headers: { 'x-tenant-slug': tenantSlugReal },
    body: {
      email: subscriberEmail
    }
  });
  expectStatus(unsubscribeRes, [200], 'unsubscribe public');

  // Verify DB state
  const subInDb = await db.query.marketingSubscribers.findFirst({
    where: eq(marketingSubscribers.email, subscriberEmail)
  });
  assert(subInDb?.unsubscribedAt !== null, 'Subscriber unsubscribedAt should be filled');

  // Step 8: Campaign Management, Suppression list & sends
  section('8) Campaign Send & Suppressions & Analytics');
  const campaignName = `Campaign_${ts}`;
  const campaignSubject = `Amazing Newsletter ${ts}`;

  // Create Campaign (draft)
  const createCampaignRes = await request<ApiSuccess<any>>('/marketing-campaigns', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-tenant-slug': tenantSlugReal
    },
    body: {
      name: campaignName,
      subject: campaignSubject,
      templateType: 'newsletter'
    }
  });
  expectStatus(createCampaignRes, [201], 'create campaign');
  const campaign = extractSuccess(createCampaignRes, 'create campaign');
  const campaignId = campaign.id;

  // Let's add a subscriber for this tenant
  const activeSubEmail = `active_sub_${ts}@example.com`;
  await request<ApiSuccess<any>>('/marketing/subscribers', {
    method: 'POST',
    headers: { 'x-tenant-slug': tenantSlugReal },
    body: {
      email: activeSubEmail,
      firstName: 'Active',
      lastName: 'User',
      source: 'newsletter'
    }
  });

  // Let's add a suppressed subscriber for this tenant
  const suppressedEmail = `suppressed_sub_${ts}@example.com`;
  await request<ApiSuccess<any>>('/marketing/subscribers', {
    method: 'POST',
    headers: { 'x-tenant-slug': tenantSlugReal },
    body: {
      email: suppressedEmail,
      firstName: 'Suppressed',
      lastName: 'User',
      source: 'newsletter'
    }
  });

  // Add the suppressed email to suppressions table
  await db.insert(emailSuppressions).values({
    email: suppressedEmail,
    tenantId: tenantId,
    reason: 'hard_bounce',
    provider: 'brevo'
  });

  // Preview the campaign
  const previewRes = await request<ApiSuccess<any>>(`/marketing-campaigns/${campaignId}/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-tenant-slug': tenantSlugReal
    },
    body: {
      email: 'test@example.com'
    }
  });
  expectStatus(previewRes, [200], 'preview campaign');

  // Send campaign
  const sendRes = await request<ApiSuccess<any>>(`/marketing-campaigns/${campaignId}/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-tenant-slug': tenantSlugReal
    }
  });
  expectStatus(sendRes, [200], 'send campaign');

  // Verify deliveries in database
  const deliveries = await db
    .select()
    .from(marketingCampaignDeliveries)
    .where(eq(marketingCampaignDeliveries.campaignId, campaignId));

  // The active subscriber should be sent/delivered successfully
  const activeDelivery = deliveries.find((d) => d.email === activeSubEmail);
  assert(!!activeDelivery, 'Active subscriber should have delivery record');
  assert(activeDelivery.deliveryStatus === 'sent', 'Active subscriber deliveryStatus should be sent');

  // The suppressed subscriber should be skipped (unsubscribed)
  const suppressedDelivery = deliveries.find((d) => d.email === suppressedEmail);
  assert(!!suppressedDelivery, 'Suppressed subscriber should have delivery record');
  assert(suppressedDelivery.deliveryStatus === 'unsubscribed', 'Suppressed subscriber deliveryStatus should be unsubscribed (skipped)');

  // Verify Analytics
  const analyticsRes = await request<ApiSuccess<any>>(`/marketing-campaigns/${campaignId}/analytics`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-tenant-slug': tenantSlugReal
    }
  });
  expectStatus(analyticsRes, [200], 'campaign analytics');
  const analytics = extractSuccess(analyticsRes, 'campaign analytics');
  assert(analytics.sent >= 1, 'Analytics sent count should be >= 1');
  assert(analytics.unsubscribed >= 1, 'Analytics unsubscribed (skipped) count should be >= 1');

  // Step 9: JWT Claims
  section('9) JWT Claims Verification');
  const claims = verifyJwt<any>(ownerToken, env.ACCESS_TOKEN_SECRET, 'access');
  // Check user state in DB
  const userRowInDb = await db.query.users.findFirst({
    where: eq(users.id, ownerUserId)
  });
  assert(claims.emailVerified === !!userRowInDb?.emailVerifiedAt, 'JWT emailVerified claim should match database');
  assert(claims.phoneVerified === !!userRowInDb?.phoneVerifiedAt, 'JWT phoneVerified claim should match database');

  // Step 10: Tenant Isolation
  section('10) Tenant Isolation');
  // Create another tenant under same owner to test cross-tenant boundary access
  const createTenant2Res = await request<ApiSuccess<any>>('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: {
      name: `Tenant isolation test ${ts}`,
      description: 'Second tenant'
    }
  });
  expectStatus(createTenant2Res, [201], 'create tenant 2');
  const tenant2Data = extractSuccess(createTenant2Res, 'create tenant 2');
  const tenant2Slug = tenant2Data.slug;

  // Register a separate viewer user who only has membership to Tenant 2
  const viewerPayload = {
    fullName: 'Viewer User',
    username: `viewer_${ts}`,
    email: `viewer_${ts}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+155566${String(ts).slice(-5)}`
  };

  const viewerSignup = await request<ApiSuccess<any>>('/auth/signup', {
    method: 'POST',
    body: viewerPayload
  });
  expectStatus(viewerSignup, [201], 'viewer signup');
  const viewerSess = extractSuccess(viewerSignup, 'viewer signup');

  const viewerVerify = await request<ApiSuccess<any>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId: viewerSess.verificationSessionId,
      code: '123456'
    }
  });
  expectStatus(viewerVerify, [201], 'viewer signup verify');
  const viewerData = extractSuccess(viewerVerify, 'viewer signup verify');
  const viewerToken = viewerData.tokens.accessToken;

  // Add the viewer to Tenant 2
  const addViewerRes = await request<ApiSuccess<any>>(`/tenants/${tenant2Slug}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: {
      userId: viewerData.user.id,
      role: 'viewer'
    }
  });
  expectStatus(addViewerRes, [201], 'add viewer to tenant 2');

  // Try to access Tenant 1's campaign list using Tenant 2's member token and Tenant 1 slug
  const crossTenantList = await request<ApiError>('/marketing-campaigns', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      'x-tenant-slug': tenantSlugReal
    }
  });
  // Should return 403 Forbidden because viewer does not have access to Tenant 1
  expectStatus(crossTenantList, [403], 'cross tenant campaign access forbidden');

  // Clean up created databases schemas specifically generated by test if needed
  section('11) Cleanup');
  await db.transaction(async (tx) => {
    // Delete campaign deliveries
    await tx.delete(marketingCampaignDeliveries).where(eq(marketingCampaignDeliveries.campaignId, campaignId));
    // Delete campaigns
    await tx.delete(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
    // Delete suppressions
    await tx.delete(emailSuppressions).where(eq(emailSuppressions.email, suppressedEmail));
    // Delete subscribers
    await tx.delete(marketingSubscribers).where(
      inArray(marketingSubscribers.email, [
        `owner_${ts}@example.com`,
        `viewer_${ts}@example.com`,
        subscriberEmail,
        activeSubEmail,
        suppressedEmail
      ])
    );
  });

  console.log('\nALL AUTH AND MARKETING INFRASTRUCTURE SMOKE TESTS PASSED!');
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nSMOKE TEST FAILED:\n');
    console.error(err);
    process.exit(1);
  });
