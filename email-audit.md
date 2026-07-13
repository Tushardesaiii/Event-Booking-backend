# Email Subsystem Audit

This audit evaluates the behavior and configuration of the transactional email delivery and verification system.

---

## 1. Email Status Overview
*   **Status**: **PARTIAL / SIMULATED**
*   **Bypass Flag**: `AUTH_BYPASS_EMAIL_VERIFICATION=true`
*   **Primary Issue**: SMTP credentials are empty, and the Brevo API Key is a mock testing placeholder.

---

## 2. Environment Variables Configuration

| Variable | Configured Value | Status | Purpose |
|:---|:---|:---|:---|
| `SMTP_HOST` | *Empty* | **MISSING** | Outgoing SMTP server address |
| `SMTP_PORT` | *Empty* | **MISSING** | Outgoing SMTP server port |
| `SMTP_USER` | *Empty* | **MISSING** | SMTP account username |
| `SMTP_PASS` | *Empty* | **MISSING** | SMTP account password |
| `BREVO_API_KEY` | `xkeysib-dummy-key-...` | **MOCK KEY** | Brevo API key for transactional emails |
| `BREVO_WEBHOOK_SECRET`| `test-sib-webhook-...` | **MOCK KEY** | Webhook verification secret |
| `AUTH_BYPASS_EMAIL_VERIFICATION` | `true` | **ACTIVE** | Dev flag to auto-verify emails |

---

## 3. Code Audit & Background Workers

### Database Outbox Queue (`src/db/schema/email-outbox.ts`)
Transactional emails are not sent directly during requests. The application writes metadata to the `email_outbox` table first.

### Email Worker (`src/lib/email/worker.ts`)
A background polling loop is initialized on server start (`src/index.ts` -> `startEmailWorker()`):
*   Interval: `env.EMAIL_WORKER_POLL_INTERVAL_MS` (5000ms by default).
*   Process: Queries pending emails from `email_outbox`, attempts sending via Brevo/SMTP, updates status to `sent` or `failed`.
*   **Failure Behavior**: When the worker attempts actual delivery, Brevo throws an authentication error due to the mock key (`401 Unauthorized`), causing emails to stay in `failed` status in the DB outbox.

### Email Verification Bypass Flow (`src/modules/auth/service.ts`)
User account verification is bypassed when signing up:
```typescript
const authAccount = await createAuthAccount(tx, {
  userId: user.id,
  provider: 'email',
  email: verifiedSession.email,
  passwordHash: verifiedSession.passwordHash,
  providerAccountId: verifiedSession.email,
  isPrimary: true,
  isVerified: env.AUTH_BYPASS_EMAIL_VERIFICATION // Set directly to true if bypass is active
});
```
*   **Impact**: Even if the email worker fails to deliver the email notification to the user, the account is marked as `isVerified=true` in the database, allowing successful login.

---

## 4. Webhook Integrity Review (`/email-marketing/webhooks/brevo`)
The webhook handler (`src/modules/email-marketing/routes.ts`) parses status events from Brevo:
```typescript
emailMarketingRoutes.post('/webhooks/brevo', validateBrevoWebhookSignature(), ...);
```
Since `BREVO_WEBHOOK_SECRET` is static/mock, incoming hooks in the Postman collection run return `403 Forbidden` if signatures cannot be verified properly, failing status tracking for campaigns.
