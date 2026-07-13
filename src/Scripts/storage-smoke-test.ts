import { randomUUID } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { tenants, users, storageObjects } from '../db/schema/index.js';
import { r2Client } from '../lib/r2.ts';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = true;

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
    body: {
      fullName: `User ${username}`,
      username,
      email: `${username}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: `+91999902${phoneSuffix}`
    }
  });
  const { verificationSessionId } = extractSuccess(startResponse, `signup start ${username}`);

  const verifyResponse = await request<ApiSuccess<any>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });
  return extractSuccess(verifyResponse, `signup verify ${username}`);
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<any>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: { name, description: 'Storage Test Tenant' }
  });
  return extractSuccess(response, `create tenant ${name}`);
}

async function run() {
  console.log('============================================================');
  console.log('ENTERPRISE CLOUDFLARE R2 STORAGE PLATFORM SMOKE TESTS STARTING...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('============================================================');

  const stamp = Date.now();
  const owner = await signup(`storage_owner_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Storage Tenant ${stamp}`);

  console.log(`✓ Created User ${owner.user.id} and Tenant ${tenant.id}`);

  // Test live S3 connectivity first
  let isR2Reachable = false;
  try {
    const testKey = `health-heartbeat.txt`;
    await r2Client.uploadObject(testKey, Buffer.from('heartbeat'), 'text/plain');
    await r2Client.headObject(testKey);
    isR2Reachable = true;
    console.log('✓ Cloudflare R2 Connection confirmed successfully.');
  } catch (err: any) {
    console.log(`⚠ Warning: R2 connectivity test bypassed (credentials might be offline or dummy): ${err.message}`);
  }

  // 1. UPLOAD SECURITY: BLOCK BAD FILES (Phase 13.4)
  console.log('\n--- 1. Verification of Upload Security constraints ---');
  const badUrlRes = await request<ApiSuccess<any>>('/storage/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      fileName: 'shell.sh',
      mimeType: 'text/plain',
      fileSize: 1024,
      module: 'users'
    }
  });
  assert(badUrlRes.status === 400, 'Security test failed: Banned file extension .sh should be rejected');
  console.log('✓ Blocked dangerous file extension .sh successfully.');

  const badMimeRes = await request<ApiSuccess<any>>('/storage/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      fileName: 'photo.jpg',
      mimeType: 'application/pdf',
      fileSize: 1024,
      module: 'users'
    }
  });
  assert(badMimeRes.status === 400, 'Security test failed: MIME/extension mismatch should be rejected');
  console.log('✓ Blocked MIME type mismatch successfully.');

  // 2. PRESIGNED UPLOAD WORKFLOW (Phase 13.5)
  console.log('\n--- 2. Presigned Upload URL generation ---');
  const validUrlRes = await request<ApiSuccess<any>>('/storage/upload-url', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      fileName: 'avatar.png',
      mimeType: 'image/png',
      fileSize: 500 * 1024, // 500 KB
      module: 'users',
      ownerId: owner.user.id
    }
  });
  const uploadInfo = extractSuccess(validUrlRes, 'get upload url');
  assert(uploadInfo.uploadUrl, 'uploadUrl must be returned');
  assert(uploadInfo.objectKey, 'objectKey must be returned');
  console.log(`✓ Presigned upload URL generated: ${uploadInfo.objectKey}`);

  // 3. COMPLETE PRESIGNED UPLOAD WORKFLOW (Phase 13.6)
  console.log('\n--- 3. Finalize upload completion & registry metadata validation ---');
  if (isR2Reachable) {
    // Write test bytes to mock successful client R2 upload
    await r2Client.uploadObject(uploadInfo.objectKey, Buffer.from('dummy avatar png bytes'), 'image/png');

    const completeRes = await request<ApiSuccess<any>>('/storage/complete', {
      method: 'POST',
      headers: authHeaders(owner.tokens.accessToken, tenant.slug),
      body: {
        objectKey: uploadInfo.objectKey
      }
    });

    const assetMeta = extractSuccess(completeRes, 'complete upload');
    assert(assetMeta.version === 1, 'Version should start at 1');
    console.log(`✓ Upload completion registered successfully. Version: ${assetMeta.version}`);
  } else {
    console.log('⚠ Skipping complete upload S3 hook checks (Offline/Mock Mode).');
  }

  // 4. VERSIONING & ROLLBACK (Phase 13.14)
  console.log('\n--- 4. Object Versioning and Rollback ---');
  // Inject mock version records to verify rollback functionality
  const testKey = `tenants/${tenant.id}/users/${owner.user.id}/document.pdf`;
  
  // Create Version 1
  const [v1] = await db.insert(storageObjects).values({
    tenantId: tenant.id,
    ownerId: owner.user.id,
    module: 'users',
    bucket: 'revelis',
    objectKey: testKey,
    version: 1,
    fileName: 'document.pdf',
    mimeType: 'application/pdf',
    fileSize: 100,
    visibility: 'private',
    metadata: { status: 'active' },
    deletedAt: new Date() // Simulate soft deleted previous version
  }).returning();

  // Create Version 2 (active)
  const [v2] = await db.insert(storageObjects).values({
    tenantId: tenant.id,
    ownerId: owner.user.id,
    module: 'users',
    bucket: 'revelis',
    objectKey: testKey,
    version: 2,
    fileName: 'document.pdf',
    mimeType: 'application/pdf',
    fileSize: 150,
    visibility: 'private',
    metadata: { status: 'active' }
  }).returning();

  console.log(`Seeded Document active version: ${v2.version}, previous version: ${v1.version}`);

  const rollbackRes = await request<ApiSuccess<any>>('/storage/rollback', {
    method: 'POST',
    headers: authHeaders(owner.tokens.accessToken, tenant.slug),
    body: {
      objectKey: testKey,
      version: 1
    }
  });

  const rolledBack = extractSuccess(rollbackRes, 'execute rollback');
  assert(rolledBack.version === 1, 'Restored file version must match target version');
  console.log(`✓ Rolled back document version to: ${rolledBack.version} successfully.`);

  // Clean up version seeds
  await db.delete(storageObjects).where(eq(storageObjects.objectKey, testKey));

  // 5. DIAGNOSTICS & METRICS (Phase 13.12)
  console.log('\n--- 5. Diagnostics and Prometheus metrics ---');
  const healthRes = await request<ApiSuccess<any>>('/health');
  expectStatus(healthRes, [200, 503], 'health check');
  
  const healthData = (healthRes.data as any)?.data || healthRes.data;
  assert(healthData?.services?.r2, 'r2 diagnostic payload must be returned');
  assert(healthData.services.r2.bucket, 'r2 bucket name must be exposed in diagnostics');
  console.log('✓ Health check endpoint returns R2 storage diagnostics.');

  const metricsRes = await request<string>('/metrics');
  expectStatus(metricsRes, [200], 'metrics check');
  assert(metricsRes.raw.includes('storage_uploads_total'), 'metrics must export storage_uploads_total');
  assert(metricsRes.raw.includes('storage_downloads_total'), 'metrics must export storage_downloads_total');
  assert(metricsRes.raw.includes('storage_deletes_total'), 'metrics must export storage_deletes_total');
  console.log('✓ Prometheus metrics check passed successfully.');

  console.log('\n============================================================');
  console.log('ALL CLOUDFLARE R2 STORAGE PLATFORM INTEGRATION SMOKE TESTS PASSED!');
  console.log('============================================================');
}

run().catch((error) => {
  console.error('\n❌ Smoke Test failed:', error);
  process.exit(1);
});
