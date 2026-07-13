# Service Dependency Health Report

This report evaluates the current status of all external services and subsystems integrated with the backend codebase.

---

## 1. Authentication Service
*   **Current Status**: **WORKING**
*   **Evidence**: Standard JWT generation (`accessToken` and `refreshToken`) is fully implemented in `src/lib/jwt.ts` and successfully verified. Dev bypass modes are active.
*   **Files Involved**: `src/modules/auth/service.ts`, `src/lib/jwt.ts`, `src/middlewares/auth.middleware.ts`
*   **Dependencies**: Database (Postgres), Crypto
*   **Failure Reason**: None
*   **Severity**: Low

---

## 2. OTP Service
*   **Current Status**: **PARTIAL** (Bypassed in Development)
*   **Evidence**: OTP starts successfully but bypasses real SMS generation due to `AUTH_BYPASS_OTP_VERIFICATION=true`. Twilio environment variables (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`) are left blank.
*   **Files Involved**: `src/modules/auth/otp.service.ts`, `src/lib/twilio/service.ts`
*   **Dependencies**: Twilio Client
*   **Failure Reason**: Missing Twilio API credentials in `.env`.
*   **Root Cause**: Credentials are not configured in local environment variables.
*   **Severity**: Medium (Blocker if bypass is deactivated)

---

## 3. Email Service
*   **Current Status**: **PARTIAL** (Bypassed in Development)
*   **Evidence**: Email sending requests are saved to the `email_outbox` database table. The background email worker polls the outbox but email delivery fails or is simulated due to `AUTH_BYPASS_EMAIL_VERIFICATION=true` and dummy Brevo keys.
*   **Files Involved**: `src/lib/email/worker.ts`, `src/lib/email/brevo.ts`, `src/config/env.ts`
*   **Dependencies**: SMTP / Brevo API
*   **Failure Reason**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` are empty. `BREVO_API_KEY` is set to a dummy testing key (`xkeysib-dummy-key-for-testing-purposes-only-123456`).
*   **Root Cause**: Local email provider credentials are not configured.
*   **Severity**: Medium

---

## 4. SMS Service
*   **Current Status**: **PARTIAL** (Bypassed in Development)
*   **Evidence**: The codebase relies on `SMS_PROVIDER=twilio`. Since Twilio credentials are not set, SMS generation is bypassed in development.
*   **Files Involved**: `src/config/env.ts`, `src/lib/twilio/service.ts`
*   **Dependencies**: Twilio Verify
*   **Failure Reason**: Empty environment configuration.
*   **Severity**: Medium

---

## 5. In-App Notifications
*   **Current Status**: **WORKING**
*   **Evidence**: System notifications are successfully stored in the `notifications` and `notification_preferences` database tables.
*   **Files Involved**: `src/modules/notifications/service.ts`, `src/modules/notifications/schema.ts`
*   **Dependencies**: Postgres Database
*   **Failure Reason**: None
*   **Severity**: Low

---

## 6. S3 Storage & Cloudflare CDN
*   **Current Status**: **PARTIAL** (Bypassed in Development)
*   **Evidence**: When `MEDIA_BYPASS_STORAGE=true`, the `S3StorageProvider` class bypasses S3 client instantiation and immediately returns a mock signed URL: `http://localhost:3000/cdn/...`. If the bypass is turned off, uploads will crash.
*   **Files Involved**: `src/modules/media/storage-provider.ts`
*   **Dependencies**: `@aws-sdk/client-s3`
*   **Failure Reason**: `S3_ACCESS_KEY` and `S3_SECRET_KEY` are not set.
*   **Root Cause**: Amazon AWS credentials are not configured.
*   **Severity**: Medium

---

## 7. Background Jobs & Queues
*   **Current Status**: **PARTIAL**
*   **Evidence**: The application starts `startEmailWorker()` inside `src/index.ts` to poll the database outbox queue. However, actual external delivery fails due to blank credentials.
*   **Files Involved**: `src/index.ts`, `src/lib/email/worker.ts`
*   **Dependencies**: Outbox DB polling loops
*   **Failure Reason**: Lack of real email client configuration.
*   **Severity**: Low

---

## 8. SOS & Safety Subsystem
*   **Current Status**: **WORKING**
*   **Evidence**: The `/sos/emergency-alert` endpoint creates `sos_alerts` records in the database and returns a list of contacts from `trusted_contacts`.
*   **Files Involved**: `src/modules/organizer-profiles/service.ts`, `src/modules/profile/routes.ts`
*   **Dependencies**: Postgres Database
*   **Failure Reason**: None
*   **Severity**: Low
