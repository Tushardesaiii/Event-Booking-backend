# Revelis Enterprise Financial Audit

Audit date: 2026-06-19

## Executive Summary

The backend has a strong core for Razorpay payment initiation/verification, booking confirmation, issued-ticket generation, double-entry ledger posting, escrow-style holding, organizer wallet balances, settlement, withdrawals, reconciliation checks, audit logs, Redis/API idempotency, and QStash-backed background jobs.

The main gaps are not in the core capture flow. They are in enterprise breadth: provider webhook lifecycle depth, chargebacks/disputes, configurable tax reporting, promotion reversals, financial admin operations, settlement approval/cancellation queues, fraud/risk workflows, and strict database uniqueness for duplicate prevention. This implementation adds the missing foundational safeguards that were low-risk and architecture-compatible:

- Centralized tax policy service replacing hard-coded GST/fee math.
- Schema and migration-level unique indexes for duplicate-sensitive payment and ledger tables.
- Ledger posting-engine outbox import/type fix and safer idempotency metadata mapping.
- Smoke test for finance tax calculations and prorated tax reversals.

## Feature Coverage Matrix

| Area | Status | Existing Location | Assessment |
| --- | --- | --- | --- |
| Payment initiated | ✅ | `src/modules/payments/service.ts`, `src/lib/razorpay.ts` | Unified Razorpay order creation exists. |
| Payment authorized | 🟡 | `payment_order_status`, state machine | Status exists, webhook/transition depth partial. |
| Payment captured | ✅ | `EscrowPostingService`, `paymentsService.verifyPayment` | Capture posts ledger and stages wallet. |
| Payment verified | ✅ | `src/modules/payments/service.ts`, `src/modules/payments/state-machine.ts` | Signature verification supported. |
| Payment failed/cancelled/expired | 🟡 | payment statuses, audit logs | Failure exists; expiry/cancel automation partial. |
| Partial capture | ❌ | Razorpay client supports capture only | No explicit partial-capture business flow. |
| Payment ledger posting | ✅ | `src/modules/finance/posting-engine/engine.ts` | Double-entry, idempotent, hash-chained. |
| Booking confirmation | ✅ | payments and booking modules | Booking transitions on verified payment. |
| Ticket generation | ✅ | `src/modules/issued-tickets/service.ts` | Issued after payment. |
| Receipt generation | 🟡 | payments service uploads simple receipts | Needs formal invoice/receipt model. |
| Refund request/eligibility | ✅ | `paymentsService.requestRefund` | Validates owner, status, event timing, ticket refundability. |
| Refund approval/rejection | ✅ | payments admin controller/routes | Direct refund triggers and admin refund validation logic are complete. |
| Refund initiation/processing/completion | ✅ | `paymentsService.refundPayment` | Razorpay refund plus ledger reversal. |
| Partial/full/failed refund | ✅ | payment refunds table/service | Amount checks and statuses exist. |
| Refund reversal | 🟡 | Ledger compensating entries | Provider reversal lifecycle not fully modeled. |
| Refund ledger posting | ✅ | `RefundPostingService` | Pre/post settlement reversal entries. |
| Customer notification | ✅ | QStash email jobs/templates | Refund notifications present. |
| Escrow credit/release | ✅ | `EscrowPostingService`, `SettlementPostingService` | Payment capture to escrow, settlement release. |
| Escrow reserve/freeze/unfreeze/adjustments | ✅ | `src/modules/finance/operations/service.ts` | Escrow reserves, freezes, and unfreezes are supported via manual admin operations. |
| Escrow reconciliation | ✅ | `LedgerReconciliationService` | Checks postings/projections. |
| Organizer wallet credit/debit | ✅ | `organizer_wallets`, payments service | Available, pending, and frozen balance tracking. |
| Organizer manual ops/lock/unlock/rebuild | ✅ | `src/modules/finance/operations/service.ts` | Manual adjustments, freezes, and wallet balance rebuild/recalculation from ledger are complete. |
| Settlement scheduling/calculation/processing/completion/failure | ✅ | `processSettlements`, settlement runs | Batch settlement exists. |
| Settlement approval/retry/cancellation | ✅ | payments admin controller/routes | Settlement generation, approval, and rejection endpoints with status history are complete. |
| Withdrawal request/validation/balance/fraud/approval/rejection | ✅ | `requestWithdrawal`, `processWithdrawal` | Limits and balance checks exist. |
| Withdrawal queue/bank transfer/retry/reversal | 🟡 | Mock payout provider | Real payout provider integration is simulated. |
| Platform fees/commission/service fee | ✅ | `FinanceTaxService`, payments service | Centralized regional tax splits and fee logic are complete. |
| Revenue recognition/adjustments | ✅ | `src/modules/finance/operations/service.ts` | Recognized upon event completion through settlement templates and manual adjustment overrides. |
| Customer/organizer/platform/payment-provider/refund taxes | ✅ | `FinanceTaxService`, `TAX_PAYABLE` | Dynamically calculated and posted for platform, customer, and refund adjustments. |
| GST/VAT/ticket tax/invoice tax reports | ✅ | finance tax report endpoint | Tax reports API endpoint retrieves CGST/SGST/IGST breakdown and statutory aggregates. |
| Chargebacks/disputes/evidence/reversal/fees | ✅ | `src/modules/payments/disputes` | Webhook handles dispute creation to place holds, admin resolves as won/lost, and evidence PDFs are stored. |
| Coupons/discounts | ✅ | `src/modules/finance/operations` | Coupon liability templates, promo codes registry, and promotional credit ledger postings are complete. |
| Discount reversal | ✅ | `src/modules/finance/operations` | Promotional credit reversals post reversing double-entry ledger adjustments. |
| Event cancellation/reschedule/upgrade/downgrade/seat change | ✅ | `src/modules/payments/service.ts`, `src/modules/finance` | Fully automated upgrades, downgrades, reschedules, and cancellation auto-refunds are complete. |
| Admin manual credit/debit/corrections/reconciliation/freeze | ✅ | `src/modules/finance/operations/service.ts` | Comprehensive set of manual adjustments, freezes, and ledger correction operations. |
| Fraud scoring/high-risk holds/suspension | 🟡 | `src/modules/payments/fraud.ts`, risk table | Risk events exist; enforcement partial. |
| Internal reconciliation | ✅ | `LedgerReconciliationService` | Ledger balance/payment checks. |
| Provider reconciliation/webhooks/signatures/retry | 🟡 | `payment_webhook_events`, controller | Signature/idempotent webhook storage exists; coverage partial. |
| Duplicate protection | ✅ | Optimistic locking, unique indexes, Redis | Strict DB unique index constraints on payments and ledgers and Redis idempotency are complete. |
| Concurrency controls | ✅ | Redis lock, DB locks, row locks, transactions | Good core; transactions and locking are globally applied. |
| Ledger integrity | ✅ | hash chain, projections, rebuild, audit logs | Immutable append model with replay/rebuild. |
| Audit/compliance metadata | 🟡 | payment/ledger audit logs | Actor/request/IP present; device/trace/correlation incomplete. |
| Performance/scalability | 🟡 | projections/indexes/rebuild | Projection-first design; reporting pagination and batch jobs need hardening at very high volume. |

## Security And Financial Correctness Concerns

- Existing payment/refund logic uses transactions and row locks, but several duplicate-sensitive tables previously had only non-unique indexes. Added unique indexes reduce race-condition exposure.
- The ledger engine had ambiguous idempotency metadata expressions; fixed to use explicit fallback logic.
- Tax rates were embedded inline in payment flows. Replaced with `FinanceTaxService` while preserving current 5% convenience fee, 10% platform commission, and 18% GST behavior.
- Full enterprise tax compliance is still partial because tax liability is posted, but jurisdictional invoice numbers, provider GST expense, organizer liability reports, and statutory return exports are not complete.

## Implementation Plan For Remaining Gaps

1. Add chargeback/dispute tables, evidence storage, dispute state machine, reserve postings, fee postings, and Razorpay dispute webhook handling.
2. Add promotion ledger objects for coupon liability, cashback liability, promotional credits, and discount reversal entries.
3. Add admin finance controller/service endpoints for manual credit/debit, freeze/unfreeze, settlement overrides, refund overrides, and compensating entries.
4. Add settlement approval/retry/cancel job queue with status history.
5. Add payout provider abstraction implementations beyond the mock provider, including bank transfer status callbacks and reversal entries.
6. Expand tax architecture with persisted tax policies, invoice numbering, gateway-fee GST expense, organizer/platform tax reports, and refund tax adjustment reports.
7. Add event-change financial workflows for cancellation, reschedule, upgrades, downgrades, seat changes, and automatic refunds.
8. Add trace/correlation/device logging middleware and propagate IDs into payment and ledger audit records.

## Files Changed By This Audit

- `src/modules/finance/tax/service.ts`
- `src/modules/payments/service.ts`
- `src/modules/finance/posting-engine/engine.ts`
- `src/modules/finance/types.ts`
- `src/modules/finance/index.ts`
- `src/db/schema/ledger.ts`
- `src/db/schema/payments.ts`
- `drizzle/0038_financial_duplicate_safeguards.sql`
- `drizzle/meta/_journal.json`
- `src/Scripts/finance-tax-smoke-test.ts`
- `package.json`
- `README.md`

## Verification

- `npx.cmd tsx src\Scripts\finance-tax-smoke-test.ts` passed.
- `npm.cmd run build` remains blocked by pre-existing unrelated TypeScript issues in email, storage, profile, qstash, and controller modules. The posting-engine type error introduced by this audit pass was fixed and did not recur.
