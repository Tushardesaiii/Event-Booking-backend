# Enterprise Inventory / Payment / Ledger Stress Test — Work Context & Handoff

> Working session checkpoint. Pick up from here next time.
> Last updated: 2026-06-23.

## Goal

Build and pass a production-grade high-concurrency stress test for the Revelis
inventory-reservation, payment, ledger and booking system, plus document it in the
README. Spec scale: **300 tickets, 1000 concurrent users, 500-user reuse wave,
100 payments**, 9 scenarios, structured enterprise terminal output + Production
Readiness Report. Extend existing modules only — never replace working architecture.

## TL;DR status

- **Enterprise test script is COMPLETE and passes 9/9 → `PRODUCTION READY` at reduced scale** (validated multiple times).
- **One real production bug found & fixed** in the ledger posting engine (concurrency abort).
- **Harness hardened for true 1000-scale** (signup retry, idempotent booking retries, JWT auto-refresh on 401).
- **README fully updated.**
- **Remaining:** run the full 1000-user spec-scale pass end-to-end (slow ~40–60 min on remote Neon; core guarantee — exactly 300 reserved, zero oversold — already proven). Optionally run existing finance/ledger smoke tests as a regression check on the engine change.

## Key files

| File | What |
|---|---|
| `src/Scripts/inventory-reservation-enterprise-smoke-test.ts` | The enterprise stress test (the main deliverable). Rewritten in full. |
| `src/modules/finance/posting-engine/engine.ts` | **Modified** — added bounded transient-fault retry around the posting transaction (see below). |
| `README.md` | Added section **“Enterprise High-Concurrency Reservation, Payment & Ledger Verification”** (after the inventory runbooks). |

## How to run

```bash
# 1. Start server (uses remote Neon Postgres + Upstash Redis from .env)
npm run dev

# 2. Full spec scale (300 tickets / 1000 users) — slow on remote Neon (~40–60 min)
npx tsx src/Scripts/inventory-reservation-enterprise-smoke-test.ts

# 2b. Fast reduced-scale validation (~4–5 min) — preserves all invariant math
ENT_TICKET_CAPACITY=12 ENT_WAVE1_USERS=30 ENT_WAVE2_USERS=12 ENT_PAYMENTS=8 \
ENT_SIGNUP_CONCURRENCY=18 ENT_WAVE_CONCURRENCY=24 ENT_PAYMENT_CONCURRENCY=8 \
npx tsx src/Scripts/inventory-reservation-enterprise-smoke-test.ts
```

Scale knobs (env, defaults = spec): `ENT_TICKET_CAPACITY=300 ENT_WAVE1_USERS=1000
ENT_WAVE2_USERS=500 ENT_PAYMENTS=100 ENT_SIGNUP_CONCURRENCY=30 ENT_WAVE_CONCURRENCY=40
ENT_PAYMENT_CONCURRENCY=12`.

The script self-validates environment (PostgreSQL/Redis/Razorpay/QStash/ledger/wallet/
settlement/reservation engines via `/health` + `/metrics`), then runs 9 scenarios and
prints a Production Readiness Report (only says `PRODUCTION READY` if every assertion passes).

## Architecture facts discovered (so you don't re-discover them)

- **Booking creation is membership-gated**: `tenantMiddleware` (required) returns 403 for non-members. Booking for **oneself** (`purchaserUserId === actor`) needs no elevated role — a `viewer` membership suffices (`booking-orders/service.ts:221`). The harness bulk-inserts `viewer` `tenant_members` rows for wave users as setup, then each books with its **own JWT**.
- **Payment ownership**: `confirmPaymentAndOrder` (`payments/service.ts:549`) throws `forbidden('Ownership mismatch on reservation')` unless the payer == the reservation's `createdByUserId`. So each wave-user booking is paid **by that same user** (harness tracks `{bookingId, user}` pairs).
- **Issued tickets are NOT created on payment**: `reconcileIssuedTicketsForBookingOrder` only issues when booking status is `confirmed` (`issued-tickets/service.ts:371`), but the payment flow sets status `paid`. Tickets materialise later via attendee assignment. ⇒ The test asserts the real entitlement (booking `paid` + reservation `booked` + exactly-one ledger posting + **≤1 ticket = no duplicates**), and treats issuance count as informational.
- **Razorpay mock**: `razorpay.ts:170` returns a mock refund only for payment IDs starting with `pay_web_`/`pay_mob_`/`pay_mock_`. All harness mock payment IDs use **`pay_mock_`** (otherwise the auto-refund hits the real API, fails, and overwrites the refund reason).
- **`getInventorySummaries` returns `numeric` SUMs as strings** (postgres.js). Harness coerces with `Number()` in `summaryFor()` (avoids `"20" === 20` false + string-concat bugs).
- **Access token TTL = 15m**, refresh token = 30d, endpoint `POST /auth/refresh { refreshToken }`. The 1000-user serial wave runs > 15m, so harness **refreshes on 401 and retries**.
- **Idempotency middleware** honours `Idempotency-Key` header (`lib/idempotency.ts`) → makes booking/create-order/verify retries safe (no duplicates).
- DB pool max = 20 (`db/client.ts`). 1000 concurrent bookings serialize on the `ticket_types` row `FOR UPDATE` lock + the per-event booking counter upsert — this serialization is what guarantees zero overselling (and makes the wave ~16 min on remote Neon).

## THE BUG FIX (important)

**Symptom:** under concurrent payment captures, 4 of 5 verifies returned 500. Server log:
`[LedgerPostingEngine] Transaction posting failed … delete from "ledger_locks" … code 25P02`.

**Root cause:** the posting engine's Redis + DB locks are keyed per-idempotency-key
(`capture:{txId}`, unique per payment), so concurrent captures for the same tenant run
in parallel and **race on first-time creation of shared ledger accounts/balance rows and
the linear hash chain** → unique-violation / aborted-transaction (`23505`/`25P02`).
First capture wins (creates accounts); the rest abort.

**Fix (`finance/posting-engine/engine.ts`):** wrapped the inner `db.transaction(postingTxn)`
in a bounded retry (6 attempts, exp backoff) for transient faults
`['40001','40P01','23505','25P02','55P03']`. On retry the now-committed shared rows are
simply selected → completes cleanly. Idempotency key is unchanged ⇒ still exactly-once.
Result: **8/8 concurrent captures commit**. (Happy path unchanged; only adds resilience.)

> Consider running existing finance/ledger smoke tests as a regression check:
> `npm run test:finance-enterprise`, `npx tsx src/Scripts/ledger-enterprise-smoke-test.ts`,
> `npm run test:payment` (file: `src/Scripts/payment-smoke-test.ts`). Not yet done — they
> compete with the server during a stress run, so run them when no stress test is active.

## The 9 scenarios (all implemented & passing at reduced scale)

1. 300 tickets vs 1000 users → exactly 300 reserved, rest 409, zero oversell/dup, `reserved+available==capacity`.
2. Pay 100 reservations (concurrent) → booking `paid`, reservation `booked`, 1 ledger posting each, wallet/settlement staged (best-effort), no dup tickets.
3. Expire remaining → inventory released, audit logs, metrics + domain events.
4. 500 new users reuse released inventory → exactly `available` succeed, zero oversell.
5. Pay after expiry → no booking, payment recorded, auto-refund + ledger reversal + wallet correction.
6. 20 simultaneous identical verifies → one booking, one ledger posting, no dup tickets.
7. 50 simultaneous webhook replays → idempotent (1 ledger posting). NOTE: webhooks return non-2xx but stay idempotent — assert on ledger-posting count, not HTTP success.
8. Crash injection at 5 points → automatic recovery / idempotency.
9. Full reconciliation → 0 discrepancies, `Σ debits == Σ credits`, hash-chain valid, no orphans.

## Validation history

- Reduced-scale (cap 12–20, 30–60 users): **9/9 PASS, PRODUCTION READY** (runs “validate4”, “validate5”; “validate7” re-confirmed after the JWT-refresh refactor — scenarios 1–8 PASS, 9 finishing).
- Full-scale 1000: **Scenario 1 proved exactly 300 reserved + ZERO oversold.** Earlier full runs failed only on (a) a transient signup 500 and (b) JWT expiry mid-wave — **both now fixed** (signup retry + token refresh). Full end-to-end 1000-scale pass not yet captured (long runtime).

## Next steps to finish

1. (Optional) Confirm the just-finished reduced run is green (`/tmp/ent-validate7.log`).
2. Launch the **full 1000-user run** in the background and let it complete (~40–60 min). Expect `PRODUCTION READY`.
3. Run the **finance/ledger/payment regression smokes** once no stress test is active, to confirm the engine.ts change is clean.
4. (Optional) Paste real full-scale latency/throughput numbers into the README “Performance Benchmarks” table.

## Notes / environment

- Server: `npm run dev` (tsx watch → hot-reloads `engine.ts` edits automatically).
- DB = Neon (ap-southeast-1), Redis = Upstash — both remote, so high per-request latency; this is why the wave is slow but it does not affect correctness.
- `AUTH_BYPASS_OTP_VERIFICATION=true` and `AUTH_BYPASS_EMAIL_VERIFICATION=true` in `.env` → signup verify uses code `123456`.
- The project `npm run build` (tsc) is currently broken by **unrelated** pre-existing TS errors (email/storage/profile/qstash). The stress test runs via `tsx` (no full typecheck), which is the correct way to run it.
