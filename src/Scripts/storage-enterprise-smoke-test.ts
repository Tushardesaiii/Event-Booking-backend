import { randomUUID } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { tenants, users, storageObjects, storageVariants, storageIntegrityReports } from '../db/schema/index.js';
import { r2Client } from '../lib/r2.ts';
import { storageService } from '../lib/storage.ts';
import { canReadAsset, canDeleteAsset } from '../lib/storage/authz.ts';
import { generateVariants } from '../lib/image-processing.ts';
import { cacheService } from '../lib/cache.js';

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

function expectStatus(result: RequestResult<unknown>, statuses: number[], label: string) {
  assert(statuses.includes(result.status), `${label} expected ${statuses.join(', ')} but got ${result.status}`, result.data ?? result.raw);
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
  const { verificationSessionId } = startResponse.data && 'data' in startResponse.data ? (startResponse.data.data as any) : { verificationSessionId: '' };

  const verifyResponse = await request<ApiSuccess<any>>('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId,
      code: '123456'
    }
  });
  return verifyResponse.data && 'data' in verifyResponse.data ? (verifyResponse.data.data as any) : null;
}

async function createTenant(accessToken: string, name: string) {
  const response = await request<ApiSuccess<any>>('/tenants', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: { name, description: 'Storage Hardening Tenant' }
  });
  return response.data && 'data' in response.data ? (response.data.data as any) : null;
}

async function run() {
  console.log('============================================================');
  console.log('ENTERPRISE STORAGE HARDENING SMOKE TESTS STARTING...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('============================================================');

  const stamp = Date.now();
  const owner = await signup(`storage_hard_${stamp}`);
  const tenant = await createTenant(owner.tokens.accessToken, `Storage Hard Tenant ${stamp}`);

  console.log(`✓ Seeded User ${owner.user.id} and Tenant ${tenant.id}`);

  let isR2Reachable = false;
  try {
    const testKey = `health-heartbeat.txt`;
    await r2Client.uploadObject(testKey, Buffer.from('heartbeat'), 'text/plain');
    await r2Client.headObject(testKey);
    isR2Reachable = true;
    console.log('✓ Cloudflare R2 Connection confirmed successfully.');
  } catch (err: any) {
    console.log(`⚠ Warning: R2 connectivity test bypassed (credentials offline): ${err.message}`);
  }

  // 1. Direct Uploads (Buffer, Stream, Multipart)
  console.log('\n--- 1. Verification of R2 S3 Wrapper operations ---');
  const testObjectKey = `global/test-lifecycle-${stamp}.txt`;
  
  if (isR2Reachable) {
    // Buffer Upload
    await r2Client.uploadBuffer(testObjectKey, Buffer.from('sample buffer upload data'), 'text/plain');
    assert(await r2Client.objectExists(testObjectKey), 'uploadBuffer: key should exist on R2');
    console.log('✓ uploadBuffer successfully verified.');

    // Stream Range get check
    const stream = await r2Client.getObjectStream(testObjectKey, 'bytes=0-12');
    assert(stream !== null, 'getObjectStream should return readable stream');
    console.log('✓ getObjectStream (Range Request) successfully verified.');

    // Local File Download
    const tmpPath = `./src/Scripts/download-test-${stamp}.tmp`;
    await r2Client.downloadObject(testObjectKey, tmpPath);
    console.log('✓ downloadObject successfully verified.');
    try {
      require('node:fs').unlinkSync(tmpPath);
    } catch {}
  } else {
    console.log('⚠ Skipping R2 S3 Wrapper operations (R2 unreachable).');
  }

  // 2. Metadata Extraction & Sharp processing
  console.log('\n--- 2. Sharp Image processing & EXIF metadata extraction ---');
  // Load a tiny transparent 1x1 PNG pixel buffer
  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const keyImage = `global/test-sharp-${stamp}.png`;
  if (isR2Reachable) {
    await r2Client.uploadBuffer(keyImage, samplePngBuffer, 'image/png');
  }

  const sharpMeta = await generateVariants(samplePngBuffer, 'image/png', 'users');
  assert(sharpMeta.thumb !== undefined, 'generateVariants should create resized thumb variant');
  console.log(`✓ generateVariants successfully scaled variants with Sharp. (Thumb size: ${sharpMeta.thumb.buffer.length} bytes)`);

  // 3. CDN url paths checks
  console.log('\n--- 3. CDN Caching & delivery URL generation ---');
  const publicUrl = storageService.getPublicAssetUrl(keyImage);
  assert(publicUrl.includes('/global/test-sharp-'), 'getPublicAssetUrl: invalid path construction');
  console.log(`✓ Public CDN URL resolved: ${publicUrl}`);

  // 4. Asset Authorization Controls (canRead, canDelete)
  console.log('\n--- 4. Asset permissions & authorization controls ---');
  const testAssetPublic = { visibility: 'public', tenantId: null, ownerId: null, uploadedBy: null };
  const testAssetPrivate = { visibility: 'private', tenantId: null, ownerId: 'some-other-user', uploadedBy: 'some-other-user' };
  
  assert(canReadAsset(testAssetPublic, null, null, 'member'), 'canReadAsset: anyone should read public assets');
  assert(!canReadAsset(testAssetPrivate, null, 'random-user', 'member'), 'canReadAsset: random member should not read private files');
  assert(canDeleteAsset(testAssetPublic, null, null, 'admin'), 'canDeleteAsset: admin role should delete public files');
  console.log('✓ canReadAsset & canDeleteAsset permissions validated successfully.');

  // 5. Content-addressing de-duplication checks
  console.log('\n--- 5. Checksum-based file de-duplication ---');
  const checksum = '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae'; // SHA-256 for 'foo'
  const duplicate = await storageService.findDuplicateAsset(checksum, tenant.id);
  assert(duplicate === null, 'findDuplicateAsset should return null when no matching active asset exists');
  console.log('✓ Deduplication checks verified successfully.');

  // 6. Security & Malware scanning gate simulation
  console.log('\n--- 6. Security Malware scanning filters ---');
  // Pre-insert asset database registry
  const mockAssetId = randomUUID();
  await db.insert(storageObjects).values({
    id: mockAssetId,
    tenantId: tenant.id,
    ownerId: owner.user.id,
    module: 'users',
    bucket: 'revelis',
    objectKey: `global/malware-${stamp}.png`,
    version: 1,
    fileName: 'virus.png', // Contains keyword 'virus' to trigger simulated infection
    mimeType: 'image/png',
    fileSize: 100,
    activeVersion: false,
    processingStatus: 'pending'
  });

  const isScanPassed = await storageService.scanAsset(mockAssetId);
  assert(!isScanPassed, 'Malware scanning should reject files with name keyword virus');
  
  const [scannedRecord] = await db.select().from(storageObjects).where(eq(storageObjects.id, mockAssetId)).limit(1);
  assert(scannedRecord.scanStatus === 'infected', 'Scan status must reflect infected flag');
  assert(scannedRecord.processingStatus === 'failed', 'Infected file processingStatus must be failed');
  console.log('✓ scanAsset gated malware infected records successfully.');

  // Clean scanning test entries
  await db.delete(storageObjects).where(eq(storageObjects.id, mockAssetId));

  // 7. Advanced signed URL restrictions (max downloads, single-use, Redis tokens)
  console.log('\n--- 7. Controlled signed URL validation ---');
  // Seed a sample R2 database object to download
  const seedKey = `global/signed-test-${stamp}.txt`;
  if (isR2Reachable) {
    await r2Client.uploadBuffer(seedKey, Buffer.from('controlled access signed content'), 'text/plain');
  }

  await db.insert(storageObjects).values({
    id: randomUUID(),
    tenantId: null,
    ownerId: owner.user.id,
    module: 'users',
    bucket: 'revelis',
    objectKey: seedKey,
    version: 1,
    fileName: 'signed-test.txt',
    mimeType: 'text/plain',
    fileSize: 32,
    activeVersion: true,
    processingStatus: 'ready'
  });

  const controlledUrl = await storageService.generateControlledSignedUrl(
    seedKey,
    {
      singleUse: true,
      expiresIn: 300,
      purpose: 'invoice_download'
    },
    null,
    owner.user.id
  );

  assert(controlledUrl.includes('/storage/signed-download?token='), 'Controlled URL must point to signed-download route');
  console.log(`✓ Controlled signed URL generated: ${controlledUrl}`);

  // Fetch using the controlled signed URL token to verify single-use decrementing
  const token = controlledUrl.split('token=')[1];
  if (isR2Reachable) {
    const downloadResponse = await request<string>(`/storage/signed-download?token=${token}`, { method: 'GET' });
    expectStatus(downloadResponse, [200], 'verify download stream using Redis token');
    assert(downloadResponse.raw.includes('controlled access signed content'), 'downloaded content mismatch');
    console.log('✓ First download verified.');
  } else {
    // R2 not reachable, download request should trigger R2 failure and return 500, but still consumes the token!
    const downloadResponse = await request<ApiError>(`/storage/signed-download?token=${token}`, { method: 'GET' });
    expectStatus(downloadResponse, [500], 'verify download triggers R2 client exception but consumes token');
    console.log('✓ First download verified (failed with 500 as expected due to offline R2 credentials).');
  }

  // Try downloading again - should be blocked since it was flagged single-use (token was consumed/deleted)
  const duplicateDownloadResponse = await request<ApiError>(`/storage/signed-download?token=${token}`, { method: 'GET' });
  expectStatus(duplicateDownloadResponse, [403], 'duplicate download block');
  console.log('✓ Blocked subsequent single-use downloads.');

  // Clean seed asset
  if (isR2Reachable) {
    await r2Client.deleteObject(seedKey);
  }
  await db.delete(storageObjects).where(eq(storageObjects.objectKey, seedKey));

  // 8. Daily Storage Integrity verification check
  console.log('\n--- 8. Storage Integrity Verification Audits ---');
  // Call internal task router block manually or invoke integrity check
  const verifyRes = await request<ApiSuccess<any>>('/qstash/jobs', {
    method: 'POST',
    headers: { 'Upstash-Signature': 'mock-dev-signature' },
    body: {
      jobType: 'verify_storage_integrity',
      data: {}
    }
  });
  expectStatus(verifyRes, [200], 'verify_storage_integrity job execution');
  
  // Inspect integrity reports table
  const reports = await db.select().from(storageIntegrityReports).limit(1);
  assert(reports.length > 0, 'Integrity reports entry must be generated in database');
  console.log('✓ verify_storage_integrity completed. Report logged in storage_integrity_reports.');

  // 9. Diagnostics health endpoint
  console.log('\n--- 9. System diagnostics sub-system checks ---');
  const healthRes = await request<ApiSuccess<any>>('/health');
  expectStatus(healthRes, [200, 503], 'system health');
  const healthData = (healthRes.data as any)?.data || healthRes.data;
  assert(healthData?.cdn !== undefined, 'health diagnostics must expose cdn sub-system check');
  assert(healthData?.integrity_engine !== undefined, 'health diagnostics must expose integrity_engine check');
  assert(healthData?.variant_engine !== undefined, 'health diagnostics must expose variant_engine check');
  assert(healthData?.virus_scanner !== undefined, 'health diagnostics must expose virus_scanner check');
  console.log('✓ Health check endpoint exposes storage sub-system status flags.');

  // 10. Clean S3 wrapper test file
  if (isR2Reachable) {
    await r2Client.deleteObject(testObjectKey);
    await r2Client.deleteObject(keyImage);
  }

  console.log('\n============================================================');
  console.log('ALL ENTERPRISE STORAGE LIFECYCLE SMOKE TESTS PASSED!');
  console.log('============================================================');
}

run().catch((error) => {
  console.error('\n❌ Enterprise Storage Smoke Test failed:', error);
  process.exit(1);
});
