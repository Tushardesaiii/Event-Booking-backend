
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { auditLogs } from '../db/schema/audit-logs.js';
import { signupVerificationSessions } from '../db/schema/signup-verification-sessions.js';
import { authAccounts } from '../db/schema/auth-accounts.js';
import { sessions } from '../db/schema/sessions.js';
import { users } from '../db/schema/users.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const OTP_CODE = process.env.SMOKE_TEST_OTP_CODE || '123456';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');
const REQUIRED_TWILIO_ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'] as const;

type JsonRecord = Record<string, unknown>;

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

interface AuthResult {
  user: {
    id: string;
    username: string;
    fullName: string;
    phoneNumber: string | null;
    phoneVerifiedAt: string | null;
  };
  session: {
    id: string;
    expiresAt: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: {
      accessToken: string;
      refreshToken: string;
    };
  };
}

interface SignupStartPayload {
  fullName: string;
  username: string;
  email: string;
  password: string;
  phoneNumber: string;
}

interface SignupStartResult {
  verificationSessionId: string;
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function section(title: string) {
  console.log('\n============================================================');
  console.log(title);
  console.log('============================================================\n');
}

function assertTwilioPrerequisites() {
  const missing = REQUIRED_TWILIO_ENV.filter((key) => !process.env[key] || process.env[key]?.trim().length === 0);

  if (missing.length > 0) {
    throw new Error(`Smoke test requires Twilio Verify environment variables: ${missing.join(', ')}`);
  }
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

function makeIdentity(prefix: string, suffix: string) {
  const stamp = `${Date.now()}${suffix}`;
  return {
    fullName: `${prefix} User ${suffix}`,
    username: `${prefix}_${stamp}`,
    email: `${prefix}_${stamp}@example.com`,
    phoneNumber: process.env.SMOKE_TEST_PHONE_NUMBER || `+1415555${stamp.slice(-4).padStart(4, '0')}`,
    password: 'StrongPassword123!'
  };
}

async function startSignup(identity: SignupStartPayload) {
  const result = await request<ApiSuccess<SignupStartResult>>('/auth/signup/start', {
    method: 'POST',
    body: identity
  });

  return extractSuccess(result, 'signup start');
}

async function verifySignup(verificationSessionId: string, code = OTP_CODE) {
  return request<ApiSuccess<AuthResult>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code
    }
  });
}

async function resendSignup(verificationSessionId: string) {
  return request<ApiSuccess<{ success: true }>>('/auth/signup/resend', {
    method: 'POST',
    body: {
      verificationSessionId
    }
  });
}

async function countAuditEvents(eventTypes: Array<'signup_started' | 'otp_sent' | 'otp_resend' | 'otp_verified' | 'otp_failed' | 'signup_completed'>, phoneNumber: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(gte(auditLogs.createdAt, since), inArray(auditLogs.eventType, eventTypes), eq(auditLogs.phoneNumber, phoneNumber)));

  return Number(row?.count ?? 0);
}

async function setSessionExpired(sessionId: string) {
  const expiredAt = new Date(Date.now() - 60 * 1000);
  await db
    .update(signupVerificationSessions)
    .set({
      status: 'expired',
      expiresAt: expiredAt,
      updatedAt: new Date()
    })
    .where(eq(signupVerificationSessions.id, sessionId));
}

async function run() {
  assertTwilioPrerequisites();

  section('AUTH SMOKE TEST START');

  const happy = makeIdentity('happy', '001');
  const invalidPhone = makeIdentity('invalid-phone', '002');
  const expired = makeIdentity('expired', '003');
  const attempts = makeIdentity('attempts', '004');
  const concurrent = makeIdentity('concurrent', '005');

  let happySessionId = '';
  let accessToken = '';
  let refreshToken = '';
  let happyUserId = '';

  section('1) Health check');
  const health = await request<{ status: string }>('/health');
  expectStatus(health, [200], 'health check');

  section('2) Signup start success');
  const happyStart = await startSignup(happy);
  happySessionId = happyStart.verificationSessionId;
  assert(happySessionId.length > 0, 'verification session id missing');

  const storedHappySession = await db.query.signupVerificationSessions.findFirst({
    where: eq(signupVerificationSessions.id, happySessionId)
  });
  assert(storedHappySession?.status === 'pending', 'signup session should be pending');

  section('3) Resend OTP success');
  const resendOne = await resendSignup(happySessionId);
  expectStatus(resendOne, [200], 'first resend');

  const resendTwo = await resendSignup(happySessionId);
  expectStatus(resendTwo, [200], 'second resend');

  const resendThree = await resendSignup(happySessionId);
  expectStatus(resendThree, [429], 'third resend should be rate limited');
  expectErrorCode(resendThree, 'RATE_LIMITED', 'resend rate limit');

  section('4) Successful verification creates user and session');
  const happyVerify = await verifySignup(happySessionId);
  expectStatus(happyVerify, [201], 'happy verification');
  const happyPayload = extractSuccess(happyVerify as RequestResult<ApiSuccess<AuthResult>>, 'happy verification');

  accessToken = happyPayload.tokens.accessToken;
  refreshToken = happyPayload.tokens.refreshToken;
  happyUserId = happyPayload.user.id;

  assert(accessToken.length > 0, 'access token missing');
  assert(refreshToken.length > 0, 'refresh token missing');
  assert(happyPayload.user.phoneNumber === happy.phoneNumber, 'phone should be stored normalized');
  assert(happyPayload.user.phoneVerifiedAt !== null, 'phone verified timestamp missing');

  const me = await request<ApiSuccess<{ user: JsonRecord }>>('/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  expectStatus(me, [200], 'me route');

  const refresh = await request<ApiSuccess<{ tokens: { accessToken: string; refreshToken: string } }>>('/auth/refresh', {
    method: 'POST',
    body: {
      refreshToken
    }
  });
  expectStatus(refresh, [200], 'refresh route');
  const refreshPayload = extractSuccess(refresh as RequestResult<ApiSuccess<{ tokens: { accessToken: string; refreshToken: string } }>>, 'refresh route');

  accessToken = refreshPayload.tokens.accessToken;
  refreshToken = refreshPayload.tokens.refreshToken;

  const logout = await request<ApiSuccess<{ success: boolean }>>('/auth/logout', {
    method: 'POST',
    body: {
      refreshToken
    }
  });
  expectStatus(logout, [200], 'logout route');

  section('5) Verified session cannot be reused');
  const reusedVerification = await verifySignup(happySessionId);
  expectStatus(reusedVerification, [404], 'reused verification');
  expectErrorCode(reusedVerification, 'VERIFICATION_SESSION_NOT_FOUND', 'reused verification');

  section('6) Duplicate identity blocked');
  const duplicateEmail = await request('/auth/signup/start', {
    method: 'POST',
    body: {
      ...makeIdentity('dup-email', '006'),
      email: happy.email
    }
  });
  expectStatus(duplicateEmail, [409], 'duplicate email');
  expectErrorCode(duplicateEmail, 'CONFLICT', 'duplicate email');

  const duplicateUsername = await request('/auth/signup/start', {
    method: 'POST',
    body: {
      ...makeIdentity('dup-username', '007'),
      username: happy.username
    }
  });
  expectStatus(duplicateUsername, [409], 'duplicate username');
  expectErrorCode(duplicateUsername, 'CONFLICT', 'duplicate username');

  const duplicatePhone = await request('/auth/signup/start', {
    method: 'POST',
    body: {
      ...makeIdentity('dup-phone', '008'),
      phoneNumber: happy.phoneNumber
    }
  });
  expectStatus(duplicatePhone, [409], 'duplicate phone');
  expectErrorCode(duplicatePhone, 'CONFLICT', 'duplicate phone');

  section('7) Invalid phone rejected');
  const invalidPhoneResponse = await request('/auth/signup/start', {
    method: 'POST',
    body: {
      ...invalidPhone,
      phoneNumber: '12345'
    }
  });
  expectStatus(invalidPhoneResponse, [400], 'invalid phone');

  section('8) Invalid OTP rejected');
  const invalidOtpSession = await startSignup(makeIdentity('invalid-otp', '009'));
  const invalidOtp = await verifySignup(invalidOtpSession.verificationSessionId, '000000');
  expectStatus(invalidOtp, [400], 'invalid otp');
  expectErrorCode(invalidOtp, 'OTP_INVALID', 'invalid otp');

  section('9) Expired session rejected');
  const expiredSession = await startSignup(expired);
  await setSessionExpired(expiredSession.verificationSessionId);
  const expiredVerify = await verifySignup(expiredSession.verificationSessionId);
  expectStatus(expiredVerify, [400], 'expired session');
  expectErrorCode(expiredVerify, 'OTP_EXPIRED', 'expired session');

  section('10) OTP attempt limit enforced');
  const attemptSession = await startSignup(attempts);
  for (let i = 1; i <= 5; i += 1) {
    const attempt = await verifySignup(attemptSession.verificationSessionId, '000000');
    expectStatus(attempt, [400], `otp attempt ${i}`);
    expectErrorCode(attempt, 'OTP_INVALID', `otp attempt ${i}`);
  }

  const sixthAttempt = await verifySignup(attemptSession.verificationSessionId, '000000');
  expectStatus(sixthAttempt, [429], 'otp attempt limit');
  expectErrorCode(sixthAttempt, 'OTP_ATTEMPTS_EXCEEDED', 'otp attempt limit');

  section('11) Concurrent verification safety');
  const concurrentSession = await startSignup(concurrent);
  const [firstConcurrent, secondConcurrent] = await Promise.all([
    verifySignup(concurrentSession.verificationSessionId),
    verifySignup(concurrentSession.verificationSessionId)
  ]);

  const concurrentStatuses = [firstConcurrent.status, secondConcurrent.status].sort();
  assert(concurrentStatuses[1] === 201, 'one concurrent verification should succeed', { firstConcurrent, secondConcurrent });
  assert(concurrentStatuses[0] === 404 || concurrentStatuses[0] === 400, 'one concurrent verification should fail', { firstConcurrent, secondConcurrent });

  const happyUser = await db.query.users.findFirst({
    where: eq(users.id, happyUserId)
  });
  assert(!!happyUser, 'happy user should exist');

  const concurrentUser = await db.query.users.findFirst({
    where: eq(users.username, concurrent.username)
  });
  assert(!!concurrentUser, 'concurrent user should exist exactly once');

  const concurrentAuthAccountCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authAccounts)
    .where(and(eq(authAccounts.provider, 'email'), eq(authAccounts.providerAccountId, concurrent.email)));
  assert(Number(concurrentAuthAccountCountRow[0]?.count ?? 0) === 1, 'concurrent auth account should not duplicate');

  section('12) Audit logs generated');
  const signupStartedCount = await countAuditEvents(['signup_started'], happy.phoneNumber);
  const otpSentCount = await countAuditEvents(['otp_sent'], happy.phoneNumber);
  const otpResendCount = await countAuditEvents(['otp_resend'], happy.phoneNumber);
  const otpVerifiedCount = await countAuditEvents(['otp_verified'], happy.phoneNumber);
  const signupCompletedCount = await countAuditEvents(['signup_completed'], happy.phoneNumber);

  assert(signupStartedCount >= 1, 'signup_started audit log missing');
  assert(otpSentCount >= 1, 'otp_sent audit log missing');
  assert(otpResendCount >= 2, 'otp_resend audit log missing');
  assert(otpVerifiedCount >= 1, 'otp_verified audit log missing');
  assert(signupCompletedCount >= 1, 'signup_completed audit log missing');

  section('13) Happy path database assertions');
  const storedUser = await db.query.users.findFirst({
    where: eq(users.id, happyUserId)
  });
  assert(storedUser?.phoneNumber === happy.phoneNumber, 'stored user phone should match');
  assert(storedUser?.phoneVerifiedAt !== null, 'stored user phone verified timestamp missing');

  const storedAuthAccount = await db.query.authAccounts.findFirst({
    where: and(eq(authAccounts.userId, happyUserId), eq(authAccounts.provider, 'email'))
  });
  assert(!!storedAuthAccount, 'auth account missing');

  const storedSession = await db.query.sessions.findFirst({
    where: eq(sessions.userId, happyUserId)
  });
  assert(!!storedSession, 'auth session missing');

  section('14) Final summary');
  console.log(JSON.stringify({
    happySessionId,
    happyUserId,
    signupStartedCount,
    otpSentCount,
    otpResendCount,
    otpVerifiedCount,
    signupCompletedCount,
    concurrentStatuses
  }, null, 2));

  console.log('\nAUTH SMOKE TEST COMPLETED');
}

run().catch((err) => {
  console.error('\nSMOKE TEST FAILED:\n');
  console.error(err);
  process.exit(1);
});

export {};