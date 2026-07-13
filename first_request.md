<USER_REQUEST>
# IMPLEMENTATION TASK — ENTERPRISE FINANCIAL AUDIT & GAP ANALYSIS FOR REVELIS

## Objective

The Revelis backend already contains a production-grade payment system with Razorpay integration and an enterprise double-entry ledger.

Your task is **NOT** to redesign or rewrite the existing implementation.

Instead, perform a comprehensive enterprise financial audit of the existing payment and finance subsystem.

Treat the existing implementation as production code.

Your responsibility is to determine whether every required enterprise financial capability already exists, whether it is partially implemented, or whether it is missing.

Only implement functionality that is missing or incomplete.

Never duplicate existing logic.

Always extend the current architecture.

Maintain complete backward compatibility.

---

# Architecture Rules

This project already contains:

* Razorpay Integration
* Enterprise Double-Entry Ledger
* Escrow
* Organizer Wallet
* Settlement Engine
* Withdrawal Engine
* Payment Verification
* Booking Engine
* Multi-Tenant Architecture
* RBAC
* Hono
* TypeScript
* Drizzle ORM
* PostgreSQL
* Redis
* Upstash QStash
* Cloudflare R2
* Brevo

Do NOT redesign any existing subsystem.

Everything must integrate into the existing architecture.

---

# Phase 1 — Enterprise Financial Audit (Mandatory)

Before writing any code, audit the existing codebase.

For every feature below determine:

* ✅ Fully Implemented
* 🟡 Partially Implemented
* ❌ Missing

For each item provide:

* Existing implementation location (file/module)
* Architectural quality
* Missing edge cases
* Security concerns
* Financial correctness concerns
* Scalability concerns
* Recommended improvements

Do not skip any item.

---

# Audit Scope

## 1. Customer Payments

Audit:

* Payment Initiated
* Payment Authorized
* Payment Captured
* Payment Verified
* Payment Failed
* Payment Cancelled
* Payment Expired
* Partial Capture
*
<truncated 5091 bytes>
se Changes
* Migration Notes

---

# Implementation Rules

* Never replace working implementations.
* Extend existing modules only.
* Preserve all public APIs.
* Preserve backward compatibility.
* Follow Controller → Service → Repository architecture.
* Use strong typing.
* Wrap all financial mutations in database transactions.
* Use immutable ledger entries.
* Prefer compensating entries over updates.
* Ensure every implementation is idempotent.
* Ensure every implementation is race-condition safe.
* Use background jobs for long-running work.
* Add comprehensive smoke tests for every newly implemented feature.

---

# Expected Deliverable

Produce:

1. A complete financial audit report.
2. A feature coverage matrix (Implemented / Partial / Missing).
3. An implementation plan for every missing capability.
4. The production-ready code implementing only the missing pieces.
5. Updated smoke tests.
6. Updated README.
7. Verification results demonstrating that the upgraded financial subsystem passes all enterprise validation checks while maintaining backward compatibility.

</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-06-19T19:20:25+05:30.

The user's current state is as follows:
Other open documents:
- d:\SpeedMVPs\Event-booking-backend\src\modules\finance\routes.ts (LANGUAGE_TYPESCRIPT)
- d:\SpeedMVPs\Event-booking-backend\src\modules\finance\types.ts (LANGUAGE_TYPESCRIPT)
- d:\SpeedMVPs\Event-booking-backend\src\modules\payments\schemas.ts (LANGUAGE_TYPESCRIPT)
- d:\SpeedMVPs\Event-booking-backend\src\db\schema\storage-variants.ts (LANGUAGE_TYPESCRIPT)
- d:\SpeedMVPs\Event-booking-backend\src\Scripts\storage-smoke-test.ts (LANGUAGE_TYPESCRIPT)
</ADDITIONAL_METADATA>
<USER_SETTINGS_CHANGE>
The user changed setting `Model Selection` from None to Gemini 3.5 Flash (Medium). No need to comment on this change if the user doesn't ask about it. If reporting what model you are, please use a human readable name instead of the exact string.
</USER_SETTINGS_CHANGE>