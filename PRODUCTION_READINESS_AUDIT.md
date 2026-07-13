# Revelis Backend — Production Deployment Readiness Audit

**Type:** Read-only production readiness assessment. No code, config, migrations, environment, or documentation was modified. This document is the only artifact produced.

**Scope audited:** `D:\Revelis\backend` — Hono + Drizzle/PostgreSQL + Redis + Cloudflare R2 + Brevo + Razorpay + Upstash QStash. 469 TypeScript files, 40+ feature modules.

**Audit method:** Direct inspection of entry points, config, middleware, routes, DB schema/migrations, and six parallel subsystem deep-dives (payments, ledger/finance, inventory/booking concurrency, auth/RBAC/tenant, storage/email/jobs, database). A read-only TypeScript typecheck (`tsc --noEmit`) was run to assess build readiness. Every material claim is backed by a `file:line` reference.

**Date basis:** Assessed against the repository state as of this audit.

---

## FINAL VERDICT

# ❌ NOT PRODUCTION READY

The backend is architecturally mature and unusually well-instrumented for a project of this age, but it **cannot be deployed safely today**. There are hard, verifiable blockers — starting with the fact that **the project does not currently compile** and the **production Docker image cannot be built from source as-is** — plus several correctness and financial-safety defects that would cause silent data/money loss in production.

### Blocking issues (must fix before any deployment)

| # | Blocker | Evidence | Severity |
|---|---------|----------|----------|
| B1 | **Source does not type-check.** `tsc --noEmit` reports **148 errors** (exit code 2). `tsconfig.json` does not set `noEmitOnError`, so `tsc` still emits, but the process exits non-zero. | `npx tsc --noEmit` → 148 errors; `tsconfig.json` (no `noEmitOnError`) | Critical |
| B2 | **Docker image is not buildable.** `Dockerfile` stage "builder" runs `RUN npm run build` (= `tsc`). Because tsc exits non-zero, the `RUN` layer fails and `docker build` aborts. | `Dockerfile:23`, `package.json` build script | Critical |
| B3 | **Runtime module-not-found in compiled `dist`.** 22 imports use a literal `.ts` extension (e.g. `import('../lib/r2.ts')`). Under `node dist/index.js` (NodeNext, compiled `.js`), these throw `ERR_MODULE_NOT_FOUND`. This breaks the `/health` R2 probe, all R2 asset-processing jobs, `payments/service.ts`, `issued-tickets/service.ts`, and `profile` controllers. | `health.route.ts:201`, `qstash.route.ts:466-468,588-593,728-731`, `storage.ts:7,19`, `jobs/email-processor.ts:5` (TS5097 ×22) | Critical |
| B4 | **Silent background-job loss.** The QStash replay-dedup key is written **before** the handler runs; on any handler failure the route returns HTTP 500 and QStash retries with the **same** `Upstash-Message-Id`, which now matches the replay key and returns `200 "Already processed"` — the retry is dropped. Every job that fails its first attempt is permanently lost (transactional emails, settlements, reservation expiry, asset processing). | `qstash.route.ts:54-63` (key set) vs `:812-816` (500 on failure) | Critical |
| B5 | **Unauthenticated public delivery of private objects.** `GET /cdn/:key{.+}` has no auth/tenant/visibility check and streams any R2 object by key, including private-module assets (organizer KYC PDFs, tickets, payment invoices) stored at deterministic keys. | `routes/index.ts:51`, `cdn.route.ts:11-12,35,63`, `storage.ts:291,484` | High |
| B6 | **Consumer-purchase inventory cache drift → false "sold out".** The consumer payment-confirm path transitions reservations to `booked` with a raw update that never decrements `reserved_quantity` or increments `sold_quantity`; `booked` reservations never expire, so cached `reserved_quantity` climbs monotonically until it trips the `reserved_not_exceed_total` CHECK and returns false 409s that block legitimate sales. No automatic compensator is scheduled. | `payments/service.ts:786-794` vs `inventory/service.ts:528-546`; `drizzle/0012` | High |
| B7 | **Mocked money movement presented as real.** The organizer payout provider is a mock (`mockPayoutProvider.createPayout` returns a fake id); withdrawals record success without moving funds. The virus scanner is a filename-substring mock wired as a gating step. | `payments/service.ts:71-76`; `storage.ts:713-742` | High |
| B8 | **No scheduled backups and no verified scheduled jobs.** `scripts/db-backup.js` exists but is never invoked (no cron/compose/CI). `qstashService.schedule()` is never called anywhere, so reservation-expiry, orphan cleanup, storage-integrity, outbox flushing, and reconciliation depend entirely on out-of-band Upstash dashboard config that cannot be verified from the repo. | `scripts/db-backup.js` (unreferenced); `lib/qstash.ts:101-128` (zero call sites) | High |

**Bottom line:** fix B1–B3 to make the artifact buildable and runnable, B4/B6/B8 to prevent silent job/inventory/data loss, B5 to stop private-data exposure, and B7 to avoid shipping mocks as production money/security controls. Until then, deployment is unsafe.

The remainder of this document details each required audit section, followed by objective scores.

---

## 1. Project Architecture

**Current implementation.** Clean modular monolith. `src/index.ts` bootstraps; `src/app.ts` builds the Hono app and middleware chain; `src/routes/index.ts` mounts 40+ feature modules (`app.route('/payments', …)` etc.). Each module follows controller → service → repository with its own `routes.ts`, `schemas`, and Drizzle schema. Cross-cutting libs live in `src/lib` (cache, r2, brevo, qstash, jwt, logger, metrics, idempotency). DB schema is split per-domain under `src/db/schema`.

**What was verified.** Consistent layering across audited modules (auth, events, payments, finance, inventory, storage). Route mounting is centralized and readable (`routes/index.ts:48-98`). Repositories consistently scope by `tenantId`.

**What could not be verified.** Whether all ~40 modules adhere to the same layering discipline internally (only a representative subset was read in depth).

**Production readiness.** Adequate. The structure scales and is maintainable.

**Risks / Missing.** Two architectural duplications reduce coherence: (a) **two disconnected money systems** — a full double-entry ledger (`src/modules/finance`) and a separate manual `settlements` table (`src/modules/settlements`) that never posts to the ledger and hardcodes a 6% fee / 0 refunds (`settlements/service.ts:9,86`); (b) **two divergent email pipelines** — `email_outbox` + in-process worker vs `email_deliveries` + QStash (`lib/email/worker.ts` vs `lib/email-client.ts`/`jobs/email-processor.ts`). An orphaned second migrations folder (`src/db/migrations`, 18 hand-numbered files) diverges from the real `drizzle/` migrations.

**Severity:** Medium (duplication/coherence, not correctness).

---

## 2. Runtime Readiness

**Current implementation.** `bootstrap()` in `index.ts` performs staged startup (config → DB handshake → Redis handshake → email worker → HTTP listen) with per-stage timing diagnostics, then sets `global.isAppReady`. Graceful shutdown on SIGTERM/SIGINT drains the HTTP server, stops the worker, and closes Postgres + Redis, with a 10s force-exit timeout (`index.ts:71-107`). Config is validated at import time (`config/env.ts`). Node 22 (Dockerfile), ESM/NodeNext.

**What was verified.** Startup sequence, graceful shutdown, env validation, and readiness flag are all present and correct. `dist/` exists (a prior successful emit).

**What could not be verified.** A clean end-to-end runtime boot (no live environment).

**Production readiness.** **Blocked.** The **build does not type-check (148 errors, B1)**; the Docker builder stage would fail (B2); and even if emitted, the `.ts`-extension imports crash key runtime paths in `dist` (B3). The database handshake failure is only logged, not fatal (`index.ts:24-26`), so the server can start "healthy" while the DB is down.

**Risks / Missing.** Build failure; runtime `.ts` imports; non-fatal DB handshake at boot.

**Severity:** Critical.

---

## 3. Hono Server

**Current implementation.** Middleware chain (`app.ts:17-121`): request logger → error boundary → global rate limit → idempotency → request/correlation IDs → response-envelope normalizer → CORS origin pre-gate → CORS. Routes mounted via `registerRoutes`. `notFound` and `onError` handlers return the standard envelope. A realtime vibes WebSocket is attached.

**What was verified.** Routing, CORS (see §15), a consistent `{success,data,error,meta}` envelope injected globally (`app.ts:30-111`), error handling that hides internals in production (§15), 9-layer rate limiting (`middlewares/rate-limit.middleware.ts`), and a full health/metrics suite: `/health/live`, `/health/startup`, `/health/ready`, `/health` (deep multi-dependency), and Prometheus `/metrics` (`health.route.ts`).

**What could not be verified.** WebSocket behavior under load.

**Production readiness.** Good, with two gaps.

**Risks / Missing.** **No security-headers middleware** (no HSTS, `X-Content-Type-Options`, `X-Frame-Options`, referrer policy) anywhere in `app.ts`. **No global request-body size limit** (no `bodyLimit`) — unbounded JSON bodies are a DoS vector. `/metrics` is unauthenticated and exposes a financial gauge (`organizer_wallet_balance` total, `health.route.ts:389-393`) — acceptable only if network-restricted.

**Severity:** Medium.

---

## 4. Environment Variables

**Current implementation.** `config/env.ts` validates all variables with Zod and supports Docker secrets from `/run/secrets` (`env.ts:5-25`). Production mode enforces a strict battery of `throw`s: bypass flags must be false; JWT secrets must be ≥32 chars and not start with `dev-`; Twilio/Brevo/Redis/QStash/Razorpay(mode-correct)/Cloudflare-R2 credentials must all be present (`env.ts:173-254`). `.env.production.example` documents every required key.

**What was verified.** The production guardrails are comprehensive and correct. `.env` and `.env.production` are correctly git-ignored; no secrets are tracked in git.

**What could not be verified.** The actual runtime `.env.production` (not in repo).

**Production readiness.** Strong — one of the best-implemented areas.

**Risks / Missing.** Two "secret" names for Razorpay (`RAZORPAY_SECRET_KEY` vs `RAZORPAY_KEY_SECRET`) and `RAZORPAY_MODE` defaulting to `test` (`env.ts:153`) are an easy misconfiguration. `EMAIL_FROM_ADDRESS` — the value actually used as the SMTP sender (`lib/email/providers/brevo/client.ts:46`) — is **not** enforced in production validation (only `EMAIL_FROM` is), so mail can send from the `no-reply@example.com` default.

**Severity:** Low–Medium.

---

## 5. Database

**Current implementation.** PostgreSQL via postgres-js + Drizzle. `client.ts:9-12`: pool `max:20`, `ssl:'require'` in production. 45 forward-only versioned migrations in `drizzle/` applied by the official Drizzle migrator (`db/migrate.ts:22`), idempotent via `__drizzle_migrations`. Money columns are `numeric(14,2)` throughout (correct decimal storage). ~540 index/uniqueIndex definitions; FKs use explicit `onDelete` (restrict on money rows, cascade on children); strong UNIQUE/idempotency keys on natural keys. `db.transaction(...)` used in 70 places across 25 services; payment/reservation paths use `SELECT … FOR UPDATE`.

**What was verified.** Migration system, index coverage of hot paths (`tenant_id`/`event_id`/`status`/`created_at`/FKs), FK/UNIQUE discipline, transaction usage, `numeric(14,2)` money storage (no `double precision`/`float` columns).

**What could not be verified.** Live migration application; actual `RUN_MIGRATIONS` value in prod (`docker-compose.prod.yml` does not set it — migrations run only if `.env.production` enables it).

**Production readiness.** Storage layer is solid; operational gaps remain.

**Risks / Missing.** **No scheduled backups** (script exists, never run) and **no PITR/WAL archiving, restore procedure, or retention policy** (B8) — the single largest DB operational gap. Orphan `src/db/migrations/` folder diverges from `drizzle/`. Out-of-band `ALTER TYPE … ADD VALUE` enum DDL runs before the migrator in a swallow-all try/catch (`migrate.ts:7-21`). CHECK constraints exist only in raw SQL, not in schema TS → drizzle-kit drift. No migration advisory lock (multi-replica boot race). Connection pool sets no `statement_timeout`/`connect_timeout`/`idle_timeout`. Application-layer money math converts `numeric` strings through JS floats in ~24 payment/ledger sites.

**Severity:** High (backups) / Medium (migrations, pool, float math).

---

## 6. Redis

**Current implementation.** `lib/cache.ts` — dual adapter (Upstash REST or ioredis) selected by env, wrapped in a circuit breaker (5-fail threshold, 10s cooldown, HALF_OPEN probe), with 3-retry exponential backoff and a 10s per-op timeout. Distributed lock via `SET key locked NX EX ttl` (`cache.ts:312-318`). ioredis uses `maxRetriesPerRequest:3` + capped retry strategy.

**What was verified.** Connection handling, circuit breaker, retries, timeouts, TTL/expiration usage, `NX EX` lock acquisition. Redis backs rate limiting, idempotency, QStash replay dedup, and payment/webhook locks.

**What could not be verified.** Behavior under a real Redis partition.

**Production readiness.** Good resilience design; two correctness caveats.

**Risks / Missing.** **Unlock is not owner-checked** — `unlock` deletes the lock key unconditionally (`cache.ts:320-324`) with no fencing token, so a slow holder can delete a lock re-acquired by another worker after TTL expiry (classic unsafe distributed-lock release). **Fail-open on outage for money-adjacent flows**: when the breaker is OPEN, `lock()` returns `false`; the payment webhook handler treats a failed lock as "already in progress" and returns 200 (no retry), silently dropping the capture (see §7). Global rate limit is `failClosed:false` (bypassed when Redis is down).

**Severity:** Medium.

---

## 7. Payments

**Current implementation.** Custom Razorpay REST client (Basic auth, 10s timeout, 3 retries) — order create/capture/refund/fetch (`lib/razorpay.ts`). Checkout callback HMAC verification (`payments/controller.ts:151-161`); webhook signature verification against `RAZORPAY_WEBHOOK_SECRET` with `payment_webhook_events` PK-based replay dedupe and Redis locks (`controller.ts:515-575`). Capture is wrapped in `db.transaction` with `SELECT … FOR UPDATE` on booking order + reservations and cryptographic reservation-token re-check (`service.ts:498-539`). Duplicate prevention via DB unique indexes on `(tenant, razorpay_order_id)`, `(tenant, razorpay_payment_id)`, `(tenant, razorpay_refund_id)`, `(tenant, idempotency_key)`.

**What was verified.** Order/capture/refund flows, webhook dedupe, transaction + row-locking on the confirm path, DB-level duplicate constraints, ledger idempotency keys.

**What could not be verified.** Whether Razorpay's webhook `payment.entity` reliably carries the `notes.reservationTokens` the confirm path requires; the `/withdrawals/callback` route auth (`routes.ts:23`, appears public).

**Production readiness.** Functionally rich but with several High-severity defects.

**Risks / Missing.**
- **Signature checks are not constant-time** — checkout `!==` (`controller.ts:156`) and webhook `===` (`razorpay.ts:229`); timing-attack exposure. Webhook secret has an unsafe fallback to the API secret (`razorpay.ts:218`).
- **Double-refund race** — the Razorpay refund API is called *before* the DB transaction and *outside any lock*, with no gateway idempotency key (`service.ts:1245-1252`); two concurrent requests can both issue real refunds before the in-tx re-check rolls one back.
- **Lost captures on Redis outage** — webhook returns 200 (no retry) when the lock can't be acquired (`controller.ts:554-556`).
- **Mocked payout provider** for withdrawals (B7); a double-payout code path exists (`service.ts:1948` and `:1982`).
- **Float math on money** (`parseFloat*100`, pro-rata rounding).
- Idempotency middleware is opt-in (client must send `Idempotency-Key`) and fails open on Redis errors (§13).

**Severity:** High.

---

## 8. Ledger

**Current implementation.** Enterprise double-entry ledger (`src/modules/finance`): insert-only postings, SHA-256 hash-chained transactions with genesis (`posting-engine/engine.ts:92-124`), balanced-entry validation in the builder (`builder.ts:93-110`), cached balance projections maintained under `FOR UPDATE` (`repository.ts:367-372`), reconciliation service, and hash-chained audit logs (`engine.ts:154-167`). Balances are rebuildable from entries (`projections/service.ts:48-210`).

**What was verified.** Append-only posting code, hash chaining, app-level double-entry balancing, reconciliation checks (per-transaction balance, projection vs recomputed, wallet vs ledger, captured-payment-has-posting), and rebuild-from-ledger capability.

**What could not be verified.** Whether any DB role actually `REVOKE`s UPDATE/DELETE (no such migration exists → assumed not); whether an external scheduler runs reconciliation/integrity (none found in-repo).

**Production readiness.** Strong design, but the immutability and integrity guarantees are not actually enforced.

**Risks / Missing.**
- **Immutability is convention-only** — no triggers/REVOKE/constraints prevent UPDATE/DELETE on ledger tables, and `ledger_entries.ledgerTransactionId` is `onDelete:'cascade'` (`ledger.ts:96`), so deleting a transaction cascade-deletes its entries.
- **Hash-chain concurrency is unsafe** — chain-head reads are locked per idempotency-key, not per tenant; two different payments for the same tenant can read the same `previousHash` and fork the chain, and `verifyChainIntegrity` orders by non-unique `createdAt`. Tamper-evidence is unreliable under load.
- **Balance-enforcement is app-only** — `postTransaction` doesn't re-validate balance; no DB `CHECK` that debits==credits or amounts>0.
- **Two sources of truth** — `ledger_account_balances` and `organizer_wallets.availableBalance` are maintained independently and can diverge.
- Reconciliation and chain-integrity are **not scheduled or alerted**; the `>0.01` tolerance masks sub-cent drift.

**Severity:** High.

---

## 9. Inventory

**Current implementation.** Reservation engine (`inventory/service.ts`): reserves via `SELECT … FOR UPDATE` on `ticket_types` (`:95-106,358`), computes availability from **derived sums** (confirmed order items + active non-expired reservations, `:118-186`), checks, then increments cached `reserved_quantity` with a non-conditional UPDATE (`:406-412`). 15-min TTL; HMAC reservation tokens with `onConflictDoNothing` idempotency. State transitions are idempotent conditional updates (`WHERE id=? AND status=<old>`). `expire_reservations` QStash job releases via `GREATEST(0, reserved - qty)`.

**What was verified.** Pessimistic `FOR UPDATE` serialization on the reserve path (sound against reserve-time oversell), idempotent state transitions, transaction wrapping of the interactive reserve/confirm/issue flows, and the 23514→409 mapping for the CHECK constraints.

**What could not be verified.** Behavior under real concurrent load.

**Production readiness.** The interactive reserve path is sound; the cache-sync and DB-invariant layers are not.

**Risks / Missing.**
- **B6 — consumer purchases permanently inflate cached `reserved_quantity`** (never decremented, `sold_quantity` never raised) → eventual false "sold out" 409s. No scheduled compensator (`reconcileCachedInventory` is never invoked automatically).
- **No true DB oversell invariant** — `drizzle/0012` adds `sold<=total` and `reserved<=total` separately but **no `sold+reserved<=total`**, so the DB permits 2× capacity; the "last line of defense" doesn't actually prevent oversell.
- **Expiry worker runs outside a transaction** (`qstash.route.ts:453-458`) → the `FOR UPDATE` is ineffective and release is non-atomic (cache drift on crash).
- **Inventory leak** — reservations stuck in `payment_verified`/`converting` have no `→expired` transition and hold inventory indefinitely.

**Severity:** High.

---

## 10. Authentication

**Current implementation.** JWT HS256, algorithm hardcoded (no `alg` read from token → no alg-confusion), constant-time signature compare with length pre-check (`lib/jwt.ts:87,125-130`), separate access/refresh secrets, 15m/30d lifetimes. Server-side sessions with argon2-hashed refresh tokens and `sid`-based revocation (`auth.middleware.ts:42-58`). argon2id passwords, 12–128 char policy requiring mixed classes. OTP via Twilio Verify in production; local dev path with sha256-hashed 6-digit codes, 5-attempt limit, race-safe atomic claim. RBAC roles viewer<staff<manager<admin<owner enforced by `requireRole`/`requirePermission`; platform-admin via a real `is_platform_admin` column.

**What was verified.** Alg hardening, constant-time JWT compare, session revocation, refresh rotation, argon2id, password policy, OTP attempt limiting + enumeration protection, production bypass-flag blocking, RBAC middleware enforcement.

**What could not be verified.** Complete password-reset → set-new-password flow (no route/controller found — appears unwired); that every one of ~40 module repos includes the `tenantId` predicate on by-id/by-slug lookups.

**Production readiness.** Strong foundations.

**Risks / Missing.** No refresh-token **reuse detection / family revocation** (replayed token is rejected but raises no alarm). Bypass flags **default to true** (dev footgun; prod-blocked). Dev-OTP uses `Math.random()` + unsalted sha256 + non-constant-time compare (dev-only paths). A non-prod email-verify bypass token exists. JWT `iss`/`aud` are accepted but never set/checked.

**Severity:** Medium.

---

## 11. Storage

**Current implementation.** Cloudflare R2 via S3 SDK (`lib/r2.ts`): singleton client, circuit breaker, 3-retry+jitter, 15s timeout, buffer/stream/multipart upload (auto >25MB), presigned upload (600s) / download (3600s) gated by `canReadAsset`, and a Redis-backed controlled signed-download token (single-use/max-downloads/IP-allowlist/TTL). Upload validation: banned-extension list, per-module MIME allowlist + size caps, extension/MIME alignment, post-upload size+Content-Type+SHA-256 re-verification. sharp-based variant pipeline.

**What was verified.** Client config, circuit breaker, retries, presigned URL scope/expiry, controlled-download token, validation rules, checksum re-verification. Production env-validation forces real R2 credentials (dummy fallback cannot reach prod).

**What could not be verified.** Real R2 connectivity.

**Production readiness.** Upload pipeline is solid; delivery and content-trust are not.

**Risks / Missing.** **B5 — `/cdn/:key` is unauthenticated and serves private objects by key** (no `visibility` check). **Open redirect** — `cdn.route.ts:29-32` 302-redirects any `http(s)://` key. **No magic-byte sniffing** — the presigned path trusts client-declared MIME. **Virus scan is a mock** (B7). **Uncached on-the-fly resize** loads the full object into memory and runs sharp per request with no `/cdn` rate limit → CPU/RAM DoS.

**Severity:** High.

---

## 12. Email

**Current implementation.** **Two pipelines.** (1) Outbox: `email_outbox` + in-process poller (`lib/email/worker.ts`, 5s interval) using `SELECT … FOR UPDATE SKIP LOCKED` (horizontally safe), DB-driven exponential backoff, per-tenant suppression, Redis heartbeat. (2) Deliveries: `email_deliveries` + `emailClient.enqueue` → QStash `process_delivery` → `jobs/email-processor.ts` → `lib/brevo.ts` (circuit breaker, `EMAIL_MAX_RETRIES=5`, honors `Retry-After`). Brevo webhook signature verified with `timingSafeEqual`.

**What was verified.** Both pipelines' queueing, locking, retry/backoff, suppression, and webhook verification.

**What could not be verified.** Actual Brevo deliverability, SPF/DKIM/sender-domain config.

**Production readiness.** Functional but duplicated and undermined by the jobs bug.

**Risks / Missing.** **Two divergent subsystems** (maintenance/consistency risk). **QStash retry loss (B4) defeats delivery retries** on the deliveries path. The outbox worker's Brevo sender has **no circuit breaker/timeout** (hammers Brevo during an outage). **No dead-letter queue or alerting** on permanently-failed rows; heartbeat is written but unconsumed. `EMAIL_FROM_ADDRESS` sender not enforced in prod validation (§4).

**Severity:** High (duplication + retry loss) / Medium (no DLQ).

---

## 13. Background Jobs

**Current implementation.** Upstash QStash. Inbound `POST /qstash/jobs` verifies the Upstash signature (current+next signing keys), rejects >5-min-stale timestamps, and dedupes replays via a 24h Redis key (`qstash.route.ts:38-63`). ~30 job types (emails, SMS, reminders, settlements, reservation expiry, asset pipeline, integrity engine). Publish has a localhost/private-IP loopback no-op guard. Handlers are stateless HTTP (scale horizontally).

**What was verified.** Signature verification, timestamp freshness, replay dedupe, handler breadth, metrics counters. Production env-validation requires all QStash keys.

**What could not be verified.** QStash per-message retry/DLQ policy (Upstash-side); whether the required recurring **schedules actually exist** in the Upstash dashboard.

**Production readiness.** **Blocked** by two High/Critical issues.

**Risks / Missing.** **B4 — replay key written before execution → failed jobs silently dropped on retry.** **B8 — `schedule()` is never called in code**, so reservation-expiry, orphan cleanup, storage-integrity, outbox flushing, and reconciliation only run if configured out-of-band (unverifiable). Handler idempotency is uneven and conflicts with the (broken) dedup. Several handlers use `.ts` runtime imports (B3).

**Severity:** Critical (B4) / High (B8).

---

## 14. API Layer

**Current implementation.** Consistent global response envelope `{success,data,error,meta:{requestId,timestamp}}` (`app.ts:30-111`); request/correlation IDs echoed in headers; Zod validation middleware for body/query/params; DB errors mapped to clean 4xx; pagination present on list endpoints; Bearer-token auth; CORS configured for browser dashboards.

**What was verified.** Envelope consistency, validation coverage on audited modules, error mapping, header propagation, CORS allow-listing of dashboard headers (`x-tenant-slug`, `Idempotency-Key`, etc.).

**What could not be verified.** Exhaustive endpoint-by-endpoint contract consistency across all 40 modules.

**Production readiness — direct consumption by React / React Native / Event Manager Dashboard / Admin Dashboard over HTTPS.** **Architecturally yes** (see §20), once the build blockers are resolved. There is **no `/v1` API versioning** — a future breaking change has no version boundary for mobile clients that cannot be force-updated. `CDN_BASE_URL` and `EMAIL_PUBLIC_URL` default to `localhost` and **must** be set to the public domain or asset/links break.

**Risks / Missing.** No API versioning; localhost-defaulting public URLs; opt-in (not enforced) idempotency on mutations.

**Severity:** Medium.

---

## 15. Security

**Current implementation.** CORS **pre-gate** rejects any non-allow-listed `Origin` with 403 before the reflecting CORS middleware (`app.ts:112-121`, `cors.ts`). Production error handler hides stacks/PG internals (`error.middleware.ts:90-137`). Parameterized Drizzle queries throughout (low SQL-injection exposure). 9-layer rate limiting with fail-closed on auth/OTP. Idempotency layer (Redis + DB fallback). Docker hardening (§18).

**What was verified.** CORS gating, prod error redaction, parameterized queries, rate-limit layering, JWT/auth hardening (§10), tenant isolation via membership gate (client tenant header is not trusted for access — a `tenant_members` row is required, `tenant.middleware.ts:99-115`).

**What could not be verified.** That every module repo applies the `tenantId` predicate (potential cross-tenant IDOR surface if any by-id lookup omits it).

**Production readiness.** Above average for auth/tenant/injection; notable web-hardening and data-exposure gaps.

**Risks / Missing.** **Unauthenticated `/cdn` private-asset exposure (B5).** **No security headers** (HSTS/nosniff/frame). **No request body-size limit.** **Non-constant-time payment signature checks + unsafe webhook secret fallback (§7).** **Logger performs no secret/PII redaction** (`lib/logger.ts` spreads context verbatim; phone numbers/IPs logged at info level) — a latent credential/PII leak if any caller passes a token. `getClientIp` trusts `x-forwarded-for`/`cf-connecting-ip` unconditionally — safe only behind a trusted proxy. Webhook signature verification is present (Razorpay, QStash, Brevo) — good. No CSRF concern (Bearer, not cookies).

**Severity:** High (CDN exposure) / Medium (headers, body limit, logging, sig timing).

---

## 16. Performance

**Current implementation.** ~540 indexes covering hot paths; Redis caching with circuit breaker; connection pool `max:20`; multipart uploads; image variant pipeline; immutable cache headers on CDN.

**What was verified.** Index coverage, caching, circuit breakers, pooling.

**What could not be verified.** Real-world latency/throughput (no load test in scope).

**Production readiness.** Reasonable, with specific DoS/scaling caveats.

**Risks / Missing.** **No request body-size limit** and **no `/cdn` rate limit** with **uncached full-decode resize** → CPU/RAM DoS. **No DB statement/connect/idle timeouts** — a hung query holds a pool slot indefinitely. Fixed `max:20` pool × replicas can exhaust Postgres. `verify_storage_integrity` full-downloads + hashes every object each run (O(total bytes)). App-layer float money math adds avoidable work and rounding risk.

**Severity:** Medium.

---

## 17. Observability

**Current implementation.** Structured JSON logging (`lib/logger.ts`); 100+ Prometheus metrics (payments, ledger, storage, email, rate limits, inventory) at `/metrics` (`health.route.ts:389-517`); four health endpoints (live/startup/ready/deep); OpenTelemetry tracing (`lib/otel.js`, gated by `OTEL_ENABLED`); Prometheus + Grafana + node/redis exporters in `docker-compose.prod.yml`; component heartbeats (worker/payments/reconciliation/webhook) surfaced in `/health`.

**What was verified.** Metrics registry, health endpoints, structured logs, OTel wiring, monitoring stack in compose.

**What could not be verified.** Whether any alerting rules consume the metrics/heartbeats (none found in repo); whether `/metrics` is network-restricted in prod.

**Production readiness.** Strong — the best-instrumented area.

**Risks / Missing.** **No alerting rules** (metrics/heartbeats are emitted but nothing pages on `qstash_jobs_failed_total`, reconciliation discrepancies, stale heartbeats, or breaker-open). **No log redaction** (§15). Reconciliation/integrity results are recorded but not surfaced. `/metrics` unauthenticated.

**Severity:** Medium.

---

## 18. Docker Readiness

**Current implementation.** Multi-stage `Dockerfile` (base → deps → builder+SBOM → prod-deps → runner). Hardened runner: non-root `USER node`, `NODE_ENV=production`, native-Node `HEALTHCHECK`, OCI labels, Asia/Kolkata TZ. `docker-compose.prod.yml`: `read_only:true` rootfs + tmpfs, `cap_drop: ALL`, `no-new-privileges`, `pids_limit`, ulimits, CPU/memory limits, log rotation, isolated internal `db-network`, healthcheck-gated `depends_on`, plus full monitoring stack. `docker-entrypoint.sh` waits for services and conditionally runs migrations.

**What was verified.** Dockerfile hardening, compose hardening/limits/networking, entrypoint wait+migrate logic, healthcheck script reference.

**What could not be verified.** A successful image build (blocked, below).

**Production readiness.** The container *design* is excellent and production-grade — **but the image cannot currently be built**: stage "builder" runs `RUN npm run build`, which exits non-zero due to the 148 type errors (B1/B2), aborting the build. Grafana ships a hardcoded default admin password (`docker-compose.prod.yml:176`). Prod compose does not set `RUN_MIGRATIONS`, so migrations may silently not run on deploy.

**Severity:** Critical (buildability) atop an otherwise strong setup.

---

## 19. Cloud Deployment Readiness

**Current implementation.** Stateless HTTP app binding `0.0.0.0:PORT` via `@hono/node-server`; externalized Postgres/Redis/R2/QStash; migrations at container start; graceful SIGTERM handling; CI publishes a signed (Cosign) image with SBOM to GHCR.

**What was verified.** Statelessness, externalized dependencies, graceful shutdown, CI build/scan/sign/publish pipeline (`.github/workflows/ci.yml`).

**Assessment per target (all contingent on fixing B1–B3 first):**
- **Railway / Render / DigitalOcean / Fly.io / AWS (ECS/EC2) / Kubernetes:** Suitable — long-running container matches the in-process email worker (which is horizontally safe via `SKIP LOCKED`). Provide managed Postgres/Redis, set `RUN_MIGRATIONS`, and front with TLS + a trusted proxy.
- **Google Cloud Run / scale-to-zero platforms:** Caveat — the in-process `setInterval` email-outbox worker and any per-instance timers stall when the instance is idle/frozen; recurring work must come from QStash schedules (which are **not registered in code**, B8). Cron-style jobs won't run reliably without an always-on instance or verified external schedules.

**What could not be verified.** Actual cloud provisioning; presence of the required Upstash schedules.

**Production readiness.** The app is cloud-shaped and CI is mature, but **not deployable until the build compiles**, backups are scheduled, and the QStash schedules are registered/verified.

**Severity:** High (blocked by build + B8).

---

## 20. Direct API Readiness

**Can the backend run on a public domain and be consumed directly by production apps over HTTPS, with no tunnel?**

**Architecturally: YES (after the build blockers are fixed).** There is **no hard dependency on localhost, ngrok, Cloudflare Tunnel, or a local proxy** in the serving path. The server binds `0.0.0.0:PORT`; CORS origins are env-driven; auth is stateless Bearer tokens; the response envelope, validation, and error format are client-friendly for React, React Native, the Event Manager Dashboard, and the Admin Dashboard. The dashboards' custom headers are already allow-listed in CORS (`cors.ts:6-17`).

**Verified.** No tunnel/localhost coupling in routing; configurable CORS; HTTPS-agnostic app (expects TLS termination at an upstream proxy/LB).

**Could not verify.** Live cross-origin calls from the actual client apps.

**Caveats that must be handled at deploy time.**
- The app serves **plain HTTP** and sets **no HSTS** — TLS must be terminated by a reverse proxy/LB, and HSTS should be added there.
- `CORS_ORIGINS`, `CDN_BASE_URL`, and `EMAIL_PUBLIC_URL` **must** be set to real public domains (they default to empty/localhost).
- `getClientIp` trusts forwarded headers → the app **must** sit behind a trusted proxy (e.g. Cloudflare) that strips client-supplied `X-Forwarded-For`/`CF-Connecting-IP`.
- A leftover `ngrok-skip-browser-warning` header remains allow-listed in CORS (`cors.ts:16`) — harmless, but a vestige of tunnel-based development.
- No `/v1` API versioning for mobile clients.

**Severity:** Medium (all deploy-time configuration, not code blockers) — but gated behind the build blockers above.

---

## SCORING (0–100)

| Dimension | Score | Justification |
|-----------|:-----:|---------------|
| **Architecture** | 72 | Clean controller-service-repository across 40+ modules with centralized routing; dragged down by two disconnected money systems, two email pipelines, and an orphan migrations folder. |
| **Security** | 60 | Strong auth/JWT/tenant-isolation/CORS-gate/rate-limiting/parameterized-queries; undermined by unauthenticated private-asset delivery, missing security headers + body limits, non-constant-time payment signatures, and no log redaction. |
| **Scalability** | 66 | Stateless handlers, `SKIP LOCKED` worker safety, Redis locks; limited by in-process worker (scale-to-zero unsafe), fixed pool size, unregistered cron schedules. |
| **Performance** | 68 | Heavy indexing + caching + circuit breakers; specific DoS vectors (uncached CDN resize, no body limit, no DB timeouts) and float money math. |
| **Financial Safety** | 42 | Double-entry ledger + reconciliation + audit exist, but immutability is convention-only, hash-chain forkable under concurrency, payouts mocked, inventory cache-drift causes false sold-out, dual balance sources, no maker-checker, double-refund race, float money math, settlements bypass the ledger. Highest-risk area for a financial platform. |
| **Deployment Readiness** | 28 | **Build fails (148 errors); Docker image not buildable; `.ts` runtime imports crash `dist`; no scheduled backups; cron schedules unregistered; prod `RUN_MIGRATIONS` unset.** Container/compose design is otherwise excellent. |
| **API Readiness** | 74 | Consistent envelope, validation, pagination, browser-ready CORS, HTTPS/tunnel-free serving model; no API versioning; localhost-defaulting public URLs; gated behind the build blockers. |
| **Observability** | 76 | 100+ Prometheus metrics, four health endpoints, OTel, full monitoring stack, heartbeats; no alerting rules, no log redaction, `/metrics` unauthenticated. |
| **Maintainability** | 56 | Modular and typed in intent, but 148 type errors mean strict typing is effectively broken; duplicated money/email subsystems and orphaned migrations raise change risk. |
| **Documentation** | 78 | Extensive README, env templates, and numerous prior audit/context docs; some describe aspirational rather than enforced behavior (e.g. ledger immutability, virus scanning). |

---

## Consolidated Risk Register (by severity)

**Critical**
1. Build does not type-check (148 errors); Docker image not buildable (B1, B2).
2. `.ts`-extension runtime imports crash compiled `dist` on health/storage/payments paths (B3).
3. QStash replay key set before execution → failed jobs silently dropped (B4).

**High**
4. `/cdn/:key` unauthenticated → private asset exposure (B5).
5. Consumer-purchase inventory cache drift → false sold-out 409s (B6).
6. Mocked payout provider + mocked virus scanner shipped as real controls (B7).
7. No scheduled backups; no PITR/restore; cron schedules unregistered/unverifiable (B8).
8. Ledger immutability convention-only + cascade-delete; hash-chain forkable under concurrency.
9. Payment signature checks not constant-time; unsafe webhook-secret fallback; double-refund race; lost captures on Redis outage.
10. No DB `sold+reserved<=total` invariant (true oversell not DB-prevented).
11. Two divergent email subsystems; QStash retry loss defeats email retries.

**Medium**
12. No security headers; no request body-size limit; no `/cdn` rate limit (DoS).
13. Logger performs no secret/PII redaction.
14. No DB statement/connect/idle timeouts; fixed pool won't scale with replicas.
15. Reconciliation/integrity present but unscheduled and unalerted; no DLQ/alerting on failed jobs.
16. No maker-checker separation of duties on financial operations.
17. Orphan migrations folder; out-of-band enum DDL; CHECK-constraint drift; prod `RUN_MIGRATIONS` unset; no migrator advisory lock.
18. No refresh-token reuse detection; password-reset flow appears unwired.
19. Float money math in payments and ledger balance rebuilds.
20. No API versioning; localhost-defaulting `CDN_BASE_URL`/`EMAIL_PUBLIC_URL`; client-IP header trust.
21. CDN open redirect; no magic-byte upload sniffing; `EMAIL_FROM_ADDRESS` not prod-enforced.

**Low**
22. JWT `iss`/`aud` unused; RBAC read-route inconsistencies (viewer can read); dev-OTP `Math.random()`/unsalted sha256; Grafana default admin password; unsafe Redis unlock (no fencing token).

---

## Notable Strengths (verified)

- **Environment validation** is comprehensive and correctly blocks unsafe production configs (bypass flags, default secrets, missing integrations).
- **Auth** is well-hardened: HS256 with no alg-confusion, constant-time JWT compare, argon2id, server-side session revocation, strong password policy.
- **Tenant isolation** requires a verified membership row — the client-supplied tenant header is never trusted for access.
- **Database storage** uses `numeric(14,2)` for all money, ~540 indexes, disciplined FKs/UNIQUE/idempotency keys, and 70 real `db.transaction` usages with `FOR UPDATE` on money/reservation paths.
- **Container/compose** design is genuinely production-grade (non-root, read-only rootfs, dropped caps, resource limits, isolated networks, healthchecks, SBOM, Cosign-signed CI images).
- **Observability** is excellent (100+ metrics, four health endpoints, OTel, full monitoring stack).
- **Resilience primitives**: circuit breakers on Redis/R2/Brevo, retries with backoff, graceful shutdown, QStash signature+timestamp+replay verification.

---

## Path to "Production Ready" (informational only — no changes were made)

Ordered by blocking priority. Presented as *what is wrong and why it matters*, not as code to apply:

1. Make the source type-check cleanly and the Docker `npm run build` succeed; eliminate the `.ts`-extension runtime imports so the compiled `dist` runs (B1–B3). Until this is done nothing else can ship.
2. Record the QStash replay key only after successful processing (or exempt retries) so failed jobs are not silently lost (B4).
3. Enforce access control / object visibility on `/cdn`, or route private assets exclusively through the signed-download endpoint (B5).
4. Sync cached `reserved`/`sold` on the consumer confirm path and add an automated inventory reconciler; add a DB `sold+reserved<=total` invariant (B6, §9).
5. Replace mocked payout and virus-scanning with real providers, or gate the features off (B7).
6. Schedule and verify: database backups (+restore/PITR), reservation-expiry, cleanup, integrity, and financial reconciliation/integrity checks (B8, §8, §13); add alerting.
7. Enforce ledger immutability at the DB level and serialize the hash chain per tenant (§8).
8. Add constant-time signature verification, a refund idempotency key + lock, and durable webhook handling under Redis outage (§7).
9. Add security headers, a request body-size limit, `/cdn` rate limiting, log redaction, and DB pool timeouts (§3, §6, §15, §16).

---

*End of read-only assessment. No project files were modified in producing this report.*
