import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailTemplates } from '../db/schema/email-templates.js';
import { emailCampaigns } from '../db/schema/email-campaigns.js';
import { emailSegments } from '../db/schema/email-segments.js';
import { emailSubscribers } from '../db/schema/email-subscribers.js';
import { emailCampaignRecipients } from '../db/schema/email-campaign-recipients.js';
import { emailOutbox } from '../db/schema/email-outbox.js';
import { emailSuppressions } from '../db/schema/email-suppressions.js';
import { emailEvents } from '../db/schema/email-events.js';
import { tenants } from '../db/schema/tenants.js';
import { users } from '../db/schema/users.js';
import { authAccounts } from '../db/schema/auth-accounts.js';
import { sessions } from '../db/schema/sessions.js';
import { createTokenPair } from '../lib/jwt.js';
import { hashPassword } from '../lib/password.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

const color = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m'
};

function paint(value: string, code: string) {
  return `${code}${value}${color.reset}`;
}

function banner(title: string) {
  console.log(`\n${paint('============================================================', color.dim)}`);
  console.log(paint(title, color.bold));
  console.log(paint('============================================================', color.dim));
}

function logPass(message: string) {
  console.log(`${paint('✔', color.green)} ${message}`);
}

function logFail(message: string) {
  console.error(`${paint('✖', color.red)} ${message}`);
}

function logInfo(message: string) {
  console.log(`${paint('•', color.cyan)} ${message}`);
}

function assert(condition: unknown, message: string, details?: unknown) {
  if (!condition) {
    const extra = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${extra}`);
  }
}

async function request<T>(path: string, options: { method?: string; headers?: HeadersInit; body?: unknown } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const raw = await response.text();
  let data: T | null = null;
  if (raw.trim().length > 0) {
    try {
      data = JSON.parse(raw) as T;
    } catch {
      data = null;
    }
  }

  if (VERBOSE) {
    console.log(paint(`HTTP ${response.status} ${path}`, color.dim));
    if (raw.trim().length > 0) console.log(raw);
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    raw
  };
}

function authHeaders(accessToken: string, tenantSlug?: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(tenantSlug ? { 'x-tenant-slug': tenantSlug } : {})
  };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  banner('EMAIL MARKETING MODULE SMOKE TEST START');
  logInfo(`Base URL: ${BASE_URL}`);

  // Create unique names
  const timestamp = Date.now();
  const testSecret = 'test-sib-webhook-secret';
  
  // Set webhook secret in environment for local verification
  process.env.BREVO_WEBHOOK_SECRET = testSecret;

  try {
    banner('1) Health Check');
    const health = await request<{ success: boolean; data: { status: string } }>('/health');
    assert(health.ok, 'Health check failed', health.raw);
    logPass('Server is reachable');

    banner('2) Setup Test Owner Account & Tenant');
    const userId = randomUUID();
    const sessionId = randomUUID();
    
    // Generate token pair
    const tokens = createTokenPair(
      {
        sub: userId,
        sid: sessionId
      },
      {
        accessSecret: process.env.ACCESS_TOKEN_SECRET || '3t0AldyGoBuqBtvWKkgzsEIz4D2Bywl6FTU8pVmwQdM2Eak8VRatJw2lgZ1Bcx0ehrX6uQoace3B14',
        refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'KahlQLLp42FkWjYuYxyJZWGafcP01cpjvMJt3yOiJHd9m4OEyfhuRFrbJuOUqAVDUyx83vG7Ps3O8a',
        accessExpiresIn: '15m',
        refreshExpiresIn: '30d'
      }
    );

    const passwordHash = await hashPassword('StrongPassword123!');
    const refreshTokenHash = await hashPassword(tokens.refreshToken);

    // Insert user, auth account, and session
    await db.insert(users).values({
      id: userId,
      username: `email_owner_${timestamp}`,
      fullName: 'Email Module Owner',
      phoneNumber: `+1415555${String(timestamp).slice(-4)}`,
      phoneVerifiedAt: new Date()
    });

    await db.insert(authAccounts).values({
      userId,
      provider: 'email',
      email: `email_owner_${timestamp}@example.com`,
      passwordHash,
      providerAccountId: `email_owner_${timestamp}@example.com`,
      isPrimary: true,
      isVerified: true
    });

    await db.insert(sessions).values({
      id: sessionId,
      userId,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    const accessToken = tokens.accessToken;
    logPass('Owner signup bypassed & user generated in DB successfully');

    // Create Tenant
    const tenantRes = await request<{ success: boolean; data: { id: string; slug: string } }>('/tenants', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: {
        name: `Email Marketing Tenant ${timestamp}`,
        description: 'Tenant for testing email marketing campaigns'
      }
    });
    assert(tenantRes.ok, 'Tenant creation failed', tenantRes.data || tenantRes.raw);
    const tenantId = tenantRes.data!.data.id;
    const tenantSlug = tenantRes.data!.data.slug;
    logPass(`Tenant created: ${tenantSlug}`);

    banner('3) Test Templates CRUD');
    // Create Template
    const templatePayload = {
      name: `Promo Template ${timestamp}`,
      subject: 'Special Offer for {{subscriber.firstName | "Valued Customer"}}!',
      htmlContent: '<p>Hi {{subscriber.firstName | "there"}},</p><p>Check out our Navratri events at {{tenant.name}}!</p>',
      textContent: 'Hi {{subscriber.firstName | "there"}}, check out Navratri events!'
    };
    const createTemplateRes = await request<{ success: boolean; data: { id: string; name: string } }>('/email-marketing/templates', {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug),
      body: templatePayload
    });
    assert(createTemplateRes.ok, 'Create template failed', createTemplateRes.data || createTemplateRes.raw);
    const templateId = createTemplateRes.data!.data.id;
    logPass(`Template created successfully: ${createTemplateRes.data!.data.name}`);

    // Get Template
    const getTemplateRes = await request<{ success: boolean; data: { id: string; subject: string } }>(`/email-marketing/templates/${templateId}`, {
      headers: authHeaders(accessToken, tenantSlug)
    });
    assert(getTemplateRes.ok, 'Get template failed', getTemplateRes.raw);
    assert(getTemplateRes.data!.data.subject === templatePayload.subject, 'Template subject mismatch');
    logPass('Get template by ID successful');

    // Update Template
    const updateTemplateRes = await request<{ success: boolean; data: { name: string } }>(`/email-marketing/templates/${templateId}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken, tenantSlug),
      body: { name: `Updated Promo Template ${timestamp}` }
    });
    assert(updateTemplateRes.ok, 'Update template failed', updateTemplateRes.raw);
    logPass(`Template updated successfully to: ${updateTemplateRes.data!.data.name}`);

    // List Templates
    const listTemplatesRes = await request<{ success: boolean; data: any[] }>('/email-marketing/templates', {
      headers: authHeaders(accessToken, tenantSlug)
    });
    assert(listTemplatesRes.ok, 'List templates failed', listTemplatesRes.raw);
    assert(listTemplatesRes.data!.data.length === 1, 'Templates list length mismatch');
    logPass('Templates list retrieved successfully');

    banner('4) Test Subscribers & CSV Import');
    // Subscribe user
    const subscriberPayload = {
      email: `test_subscriber_${timestamp}@example.com`,
      firstName: 'Alice',
      lastName: 'Smith'
    };
    const subscribeRes = await request<{ success: boolean; data: { id: string; email: string } }>('/email-marketing/subscribers', {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug),
      body: subscriberPayload
    });
    assert(subscribeRes.ok, 'Subscriber subscription failed', subscribeRes.data || subscribeRes.raw);
    logPass(`Single subscriber subscribed: ${subscribeRes.data!.data.email}`);

    // CSV Import
    const csvImportPayload = {
      subscribers: [
        { email: `csv_1_${timestamp}@example.com`, firstName: 'Bob', lastName: 'Jones' },
        { email: `csv_2_${timestamp}@example.com`, firstName: 'Charlie', lastName: 'Brown' },
        { email: `csv_3_${timestamp}@example.com`, firstName: 'Diana', lastName: 'Prince' }
      ]
    };
    const csvImportRes = await request<{ success: boolean; message: string; data: any[] }>('/email-marketing/subscribers/import', {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug),
      body: csvImportPayload
    });
    assert(csvImportRes.ok, 'CSV import failed', csvImportRes.data || csvImportRes.raw);
    assert(csvImportRes.data!.data.length === 3, 'Imported subscribers count mismatch');
    logPass('CSV subscribers import successful');

    // List Subscribers
    const listSubscribersRes = await request<{ success: boolean; data: any[] }>('/email-marketing/subscribers', {
      headers: authHeaders(accessToken, tenantSlug)
    });
    assert(listSubscribersRes.ok, 'List subscribers failed', listSubscribersRes.raw);
    assert(listSubscribersRes.data!.data.length === 4, 'Total subscribers count mismatch (expected 4)');
    logPass('Subscribers list retrieved successfully');

    banner('5) Test Segments CRUD');
    // Create Segment matching CSV uploads
    const segmentPayload = {
      name: `CSV Uploads Segment ${timestamp}`,
      description: 'Segment targeting users from CSV import',
      filters: {
        type: 'custom_uploads'
      }
    };
    const createSegmentRes = await request<{ success: boolean; data: { id: string; name: string } }>('/email-marketing/segments', {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug),
      body: segmentPayload
    });
    assert(createSegmentRes.ok, 'Create segment failed', createSegmentRes.data || createSegmentRes.raw);
    const segmentId = createSegmentRes.data!.data.id;
    logPass(`Segment created successfully: ${createSegmentRes.data!.data.name}`);

    // List Segments
    const listSegmentsRes = await request<{ success: boolean; data: any[] }>('/email-marketing/segments', {
      headers: authHeaders(accessToken, tenantSlug)
    });
    assert(listSegmentsRes.ok, 'List segments failed', listSegmentsRes.raw);
    assert(listSegmentsRes.data!.data.length === 1, 'Segments list length mismatch');
    logPass('Segments list retrieved successfully');

    banner('6) Test Campaigns Scheduling & Execution');
    // Create Campaign
    const campaignPayload = {
      name: `Grand Fest Campaign ${timestamp}`,
      subject: 'Join Navratri festival, {{subscriber.firstName}}!',
      templateId,
      segmentId
    };
    const createCampaignRes = await request<{ success: boolean; data: { id: string; status: string } }>('/email-marketing/campaigns', {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug),
      body: campaignPayload
    });
    assert(createCampaignRes.ok, 'Create campaign failed', createCampaignRes.data || createCampaignRes.raw);
    const campaignId = createCampaignRes.data!.data.id;
    assert(createCampaignRes.data!.data.status === 'draft', 'New campaign status is not draft');
    logPass(`Campaign created successfully in status: ${createCampaignRes.data!.data.status}`);

    // Duplicate Campaign
    const duplicateRes = await request<{ success: boolean; data: { id: string; name: string } }>(`/email-marketing/campaigns/${campaignId}/duplicate`, {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug)
    });
    assert(duplicateRes.ok, 'Duplicate campaign failed', duplicateRes.raw);
    assert(duplicateRes.data!.data.name === `Copy of ${campaignPayload.name}`, 'Duplicated campaign name mismatch');
    logPass(`Campaign duplicated successfully: ${duplicateRes.data!.data.name}`);

    // Schedule Campaign
    const scheduleTime = new Date(Date.now() + 60000).toISOString(); // 1 minute in the future
    const scheduleRes = await request<{ success: boolean; data: { status: string; scheduledAt: string } }>(`/email-marketing/campaigns/${campaignId}/schedule`, {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug),
      body: { scheduledAt: scheduleTime }
    });
    assert(scheduleRes.ok, 'Schedule campaign failed', scheduleRes.raw);
    assert(scheduleRes.data!.data.status === 'scheduled', 'Scheduled campaign status mismatch');
    logPass(`Campaign scheduled successfully for: ${scheduleRes.data!.data.scheduledAt}`);

    // Cancel Schedule
    const cancelRes = await request<{ success: boolean; data: { status: string } }>(`/email-marketing/campaigns/${campaignId}/cancel`, {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug)
    });
    assert(cancelRes.ok, 'Cancel schedule failed', cancelRes.raw);
    assert(cancelRes.data!.data.status === 'draft', 'Cancelled campaign status should revert to draft');
    logPass('Campaign schedule cancelled successfully');

    // Trigger Campaign Send Immediately
    logInfo('Triggering immediate campaign send execution...');
    const sendNowRes = await request<{ success: boolean; data: { recipientsEnqueued: number } }>(`/email-marketing/campaigns/${campaignId}/send`, {
      method: 'POST',
      headers: authHeaders(accessToken, tenantSlug)
    });
    assert(sendNowRes.ok, 'Send campaign now failed', sendNowRes.data || sendNowRes.raw);
    assert(sendNowRes.data!.data.recipientsEnqueued === 3, `Expected 3 recipients enqueued, got ${sendNowRes.data!.data.recipientsEnqueued}`);
    logPass('Campaign execution triggered successfully');

    banner('7) Verification of Outbox Queueing');
    // Verify that the campaign has transition status to 'sent'
    const [dbCampaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).limit(1);
    assert(dbCampaign.status === 'sent', `Campaign database status should be sent, got ${dbCampaign.status}`);
    logPass('Campaign database status transitioned to sent');

    // Verify campaign recipients were created in database
    const dbRecipients = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaignId));
    assert(dbRecipients.length === 3, `Expected 3 recipient rows in DB, found ${dbRecipients.length}`);
    logPass(`Verified 3 recipients enqueued in database`);

    // Verify outbox queue records exist
    const dbOutbox = await db.select().from(emailOutbox).where(eq(emailOutbox.campaignId, campaignId));
    assert(dbOutbox.length === 3, `Expected 3 outbox records in DB, found ${dbOutbox.length}`);
    logPass('Verified 3 outbox messages enqueued in database');

    // Verify outbox payload personalization is correct
    const checkPayload = dbOutbox[0].payloadJson as any;
    assert(checkPayload.htmlContent.includes('Bob') || checkPayload.htmlContent.includes('Charlie') || checkPayload.htmlContent.includes('Diana'), 'Personalized html content missing first name');
    assert(checkPayload.htmlContent.includes(`Email Marketing Tenant ${timestamp}`), 'Personalized html content missing tenant context');
    logPass('Verified outbox message personalization engine');

    banner('8) Outbox Background Worker Processing Simulation');
    // Wait for the background worker to process the queue (poller runs every 5 seconds)
    logInfo('Waiting 6 seconds for background worker to process queue...');
    await sleep(6500);

    // Verify outbox queue status transitioned to completed or failed (failed if Brevo isn't configured, but shouldn't be pending)
    const dbOutboxProcessed = await db.select().from(emailOutbox).where(eq(emailOutbox.campaignId, campaignId));
    const pendingCount = dbOutboxProcessed.filter(o => o.status === 'pending').length;
    assert(pendingCount === 0, `Expected 0 pending outbox items after worker poll, found ${pendingCount} pending`);
    logPass('Verified background outbox worker successfully picked up and processed queue');

    banner('9) Simulated Webhook Ingestion & suppressions');
    // Find one of the recipient records to link webhook event
    const recipientToTest = dbRecipients[0];
    const subscriberToTest = await db.select().from(emailSubscribers).where(eq(emailSubscribers.id, recipientToTest.subscriberId)).limit(1).then(r => r[0]);
    
    // Simulate updating provider message ID
    const mockMessageId = `mock_brevo_message_${timestamp}`;
    await db.update(emailCampaignRecipients)
      .set({ providerMessageId: mockMessageId })
      .where(eq(emailCampaignRecipients.id, recipientToTest.id));

    // Construct fake webhook payload (Unsubscribe event)
    const webhookPayload = {
      event: 'unsubscribe',
      id: Math.floor(Math.random() * 100000000) + 1,
      email: subscriberToTest.email,
      camp_id: 12345,
      ts: Date.now(),
      'message-id': mockMessageId
    };

    // Calculate signature
    const rawBody = JSON.stringify(webhookPayload);
    const signature = createHmac('sha256', testSecret).update(rawBody).digest('hex');

    // Send Webhook request
    logInfo(`Sending simulated unsubscribe webhook to subscriber ${subscriberToTest.email}...`);
    const webhookRes = await request<{ success: boolean }>('/email-marketing/webhooks/brevo', {
      method: 'POST',
      headers: {
        'x-sib-signature': signature
      },
      body: webhookPayload
    });
    assert(webhookRes.ok, 'Webhook submission failed', webhookRes.data || webhookRes.raw);
    logPass('Webhook request accepted with 200 OK');

    // Verify recipient status updated in DB
    const [updatedRecipient] = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipientToTest.id)).limit(1);
    assert(updatedRecipient.status === 'failed', `Recipient status should be failed after unsubscribe, got ${updatedRecipient.status}`);
    logPass('Verified recipient status updated to failed');

    // Verify event is logged in database
    const [loggedEvent] = await db.select().from(emailEvents).where(eq(emailEvents.recipientId, recipientToTest.id)).limit(1);
    assert(loggedEvent && loggedEvent.eventType === 'unsubscribe', 'Unsubscribe event was not logged in DB');
    logPass('Verified event type logged in database');

    // Verify suppression is added to DB
    const [suppression] = await db.select().from(emailSuppressions).where(and(eq(emailSuppressions.tenantId, tenantId), eq(emailSuppressions.email, subscriberToTest.email))).limit(1);
    assert(suppression && suppression.reason === 'unsubscribe', 'Suppression record missing or reason mismatch');
    logPass('Verified suppression record added to database');

    // Verify subscriber status changed to unsubscribed
    const [updatedSubscriber] = await db.select().from(emailSubscribers).where(eq(emailSubscribers.id, subscriberToTest.id)).limit(1);
    assert(updatedSubscriber.status === 'unsubscribed', `Subscriber status should be unsubscribed, got ${updatedSubscriber.status}`);
    logPass('Verified subscriber status updated to unsubscribed in database');

    banner('EMAIL MARKETING SMOKE TEST PASSED SUCCESSFULLY 🎉');
  } catch (error) {
    banner('EMAIL MARKETING SMOKE TEST FAILED ✖');
    logFail(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

run();
