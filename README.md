# Revelis Enterprise API Platform - Reference Manual

Welcome to the **Revelis Developer API Reference Manual**. This document is a comprehensive, production-grade specification of the Revelis backend, designed to act as the single source of truth for frontend developers, mobile app engineers (React Native), internal services, automation agents, and third-party SaaS integrations.

The Revelis API is built to be **fully API-first, integration-ready, and contract-driven**.

---

## 1. System Overview

Revelis is a multi-tenant event management, ticketing, and secure financial platform. It serves as the transaction and ledger authority, coordinating complex processes across multiple domain modules.

### Multi-Tenant Architecture
Every resource (venue, event, ticket, booking, wallet, ledger transaction) in Revelis is strictly isolated within a **Tenant** boundary. 
- Separation is enforced at the network routing level using tenant slugs.
- Separation is enforced at the database level using compound unique indexes on `(tenant_id, slug)` or `(tenant_id, id)`.

```
                        ┌───────────────────────────────────────┐
                        │              Client API               │
                        └───────────────────┬───────────────────┘
                                            │ Header: x-tenant-slug
                                            ▼
                        ┌───────────────────────────────────────┐
                        │      Tenant Isolation Middleware      │
                        └───────────────────┬───────────────────┘
                                            │ Resolves Tenant ID
                                            ▼
                        ┌───────────────────────────────────────┐
                        │      Modular Monolith Services        │
                        │ ┌───────────────┐   ┌───────────────┐ │
                        │ │     Auth      │   │    Events     │ │
                        │ └───────────────┘   └───────────────┘ │
                        │ ┌───────────────┐   ┌───────────────┐ │
                        │ │   Bookings    │   │   Payments    │ │
                        │ └───────────────┘   └───────────────┘ │
                        │ ┌───────────────┐   ┌───────────────┐ │
                        │ │    Ledger     │   │   Inventory   │ │
                        │ └───────────────┘   └───────────────┘ │
                        └───────────────────┬───────────────────┘
                                            │ Bounded Transaction
                                            ▼
                        ┌───────────────────────────────────────┐
                        │         PostgreSQL Database           │
                        │       (Isolated Row Partition)        │
                        └───────────────────────────────────────┘
```

### Core Modules Overview
1. **Auth**: Handles multi-step signup (via OTP SMS), password credentials login, email verification, session lifecycle, and Role-Based Access Control (RBAC).
2. **Events**: Manages venues, tags, categories, event metadata, and event series templates.
3. **Bookings**: Runs the order lifecycle state machine, coordinating ticket holds and attendee allocations.
4. **Payments**: Integrates with Razorpay for order creation and verification, supporting dual-case normalization (camelCase/snake_case) for web/native SDK callbacks.
5. **Ledger**: Enforces double-entry bookkeeping with immutable cryptographically-chained ledger transactions and entries.
6. **Wallet**: Tracks organizers' pending and available balances, processing withdrawal locks and settlement payouts.
7. **Settlements**: Automatically releases escrow funds to organizer wallets and records platform fees/taxes upon event completion.
8. **Inventory**: Manages pessimistic locking and reservation TTLs to ensure exactly zero-overselling.
9. **Refunds**: Implements automatic, partial, and manual refund triggers, reversing ledger balances net-zero.

---

## 2. Authentication System

The Revelis authentication system uses short-lived JWT Access Tokens (Header-passed Bearer scheme) and long-lived database-backed Refresh Tokens. 

### Multi-Step Signup Flow
1. **POST /auth/signup/start**: Initiates verification, creating a pending session in `signup_verification_sessions` and sending a Twilio OTP.
2. **POST /auth/signup/verify**: Checks the SMS code. If valid, persists the `users` record, updates `auth_accounts`, opens a session, and returns JWT tokens.

```
  Client                     Revelis Server                   Twilio Verify
    │                              │                               │
    ├───── POST /auth/signup/start ┼──────────────────────────────▶│
    │      (Name, Phone, Pass)     │  Generates Verification       │
    │                              │  Session (expires 15m)        │
    │                              │                               │
    │                              │◀────── Send OTP SMS ──────────┤
    │                              │                               │
    ├───── POST /auth/signup/verify┼──────────────────────────────▶│
    │      (Session ID, SMS Code)  │  Compares Code                │
    │                              │  If valid, creates:           │
    │                              │  - User Record                │
    │                              │  - Auth Credentials           │
    │                              │  - Session                    │
    │                              │                               │
    │◀───── Returns JWT Tokens ────┤                               │
```

### Endpoints
* **`POST /auth/signup/start`** (or `/auth/signup`)
  - **Auth**: Public
  - **Request Body**:
    ```json
    {
      "fullName": "Alice Johnson",
      "username": "alicej",
      "email": "alice@example.com",
      "password": "SecurePassword123!",
      "phoneNumber": "+919999111234",
      "marketingOptIn": true
    }
    ```
  - **Response (201 Created)**:
    ```json
    {
      "success": true,
      "data": {
        "verificationSessionId": "c4d3b6f2-8c11-477c-a496-e2a27ff3644f"
      },
      "error": null,
      "meta": {
        "timestamp": "2026-06-23T14:10:00.000Z",
        "requestId": "req_8a883b2a"
      }
    }
    ```

* **`POST /auth/signup/verify`**
  - **Auth**: Public
  - **Request Body**:
    ```json
    {
      "verificationSessionId": "c4d3b6f2-8c11-477c-a496-e2a27ff3644f",
      "code": "123456"
    }
    ```
  - **Response (201 Created)**:
    ```json
    {
      "success": true,
      "data": {
        "user": {
          "id": "usr_9f8e7d6c",
          "username": "alicej",
          "fullName": "Alice Johnson",
          "phoneNumber": "+919999111234"
        },
        "tokens": {
          "accessToken": "eyJhbGciOi...",
          "refreshToken": "eyJhbGciOi..."
        }
      },
      "error": null,
      "meta": {
        "timestamp": "2026-06-23T14:10:30.000Z",
        "requestId": "req_f8e7d6cba"
      }
    }
    ```

* **`POST /auth/login`**
  - **Auth**: Public
  - **Request Body**:
    ```json
    {
      "email": "alice@example.com",
      "password": "SecurePassword123!"
    }
    ```
  - **Response (200 OK)**: Conforms to the standard JWT payload object shown above.

* **`POST /auth/refresh`**
  - **Auth**: Public
  - **Request Body**:
    ```json
    {
      "refreshToken": "eyJhbGciOi..."
    }
    ```
  - **Response (200 OK)**: Returns a rotated access token and a newly hashed refresh token.

* **`POST /auth/logout`**
  - **Auth**: Public
  - **Request Body**:
    ```json
    {
      "refreshToken": "eyJhbGciOi..."
    }
    ```
  - **Response (200 OK)**: Returns `success: true`.

* **`GET /auth/me`**
  - **Auth**: Bearer Token
  - **Response (200 OK)**: Returns the currently authenticated user payload, linked auth accounts, and tenant memberships.

---

## 3. Multi-Tenant Model

Revelis enforces tenant boundaries strictly. Requests targeting tenant-specific APIs must include the tenant identifier.

### Isolation Mechanics
1. **API Routing Scopes**: The client passes the HTTP header:
   `x-tenant-slug: <tenant-slug>`
2. **Scoping Middleware**: `tenantMiddleware` checks that the slug is active, verifies user membership, and sets the active `tenant` and `tenantMembership` inside Hono context.
3. **Database Scoping**: Database queries append filters enforcing tenant ownership:
   `and(eq(table.tenantId, tenantId), eq(table.slug, resourceSlug))`

### Role-Based Access Control (RBAC)
User membership is mapped to roles with a rank hierarchy. Roles inherit all permissions of lower rank roles:

| Role | Rank | Key Permissions | Description |
|---|---|---|---|
| **Owner** | 4 | All permissions | Core workspace manager; can delete/transfer tenant |
| **Admin** | 3 | `member.manage`, `tenant.manage` | Performs tenant configuration changes and adds staff |
| **Manager**| 2 | `event.manage`, `ticket.manage`, `venue.manage` | Creates events, publishes ticket types, and sets pricing |
| **Staff** | 1 | `booking.read`, `ticket.read`, `ticket.checkin` | Gate operator; scans barcodes and handles check-ins |
| **Viewer** | 0 | `analytics.view`, `email.view` | Read-only reporting access |

---

## 4. Events Module API

The events module manages venues, event category links, and tag mapping.

### Validation Rules
- **Scheduling**: An event's `endDateTime` must be chronologically after its `startDateTime`.
- **Venue Limits**: The sum of all active `ticket_types` capacities for an event must not exceed the physical venue capacity.
- **Draft to Published State Transition**: To change event status to `published`, the event must have a title, venue, and at least one active ticket type. Publishing triggers email campaign notifications.

### Endpoints
* **`POST /events`**
  - **Permissions**: `event.create` / `event.manage`
  - **Request Body**:
    ```json
    {
      "title": "Sunburn Festival Goa",
      "shortDescription": "Asia's largest dance music festival",
      "description": "Experience three days of electronic music in Goa.",
      "startDateTime": "2026-12-27T14:00:00.000Z",
      "endDateTime": "2026-12-30T22:00:00.000Z",
      "timezone": "Asia/Kolkata",
      "venueId": "ven_5a6b7c8d-e9f0-1a2b-3c4d-5e6f7a8b9c0d",
      "status": "draft",
      "visibility": "public",
      "isFeatured": true
    }
    ```
  - **Response (201 Created)**: Returns the persisted event object under the standard response wrapper.

---

## 5. Ticketing & Inventory API

Revelis guarantees exactly zero ticket overselling using a multi-layer reservation holding system.

### Inventory Hold Flow (15-Minute TTL)
```
  Customer                     Hono API                     Redis Lock                   Postgres DB
     │                            │                             │                             │
     ├───── POST /booking-orders ─┼────────────────────────────▶│                             │
     │                            │  Check Redis Lock           │                             │
     │                            │  revelis:lock:ticket_type   │                             │
     │                            │                             │── SELECT FOR UPDATE ───────▶│
     │                            │                             │  - Sort UUIDs deterministically
     │                            │                             │  - Check capacity           │
     │                            │                             │                             │
     │                            │                             │◀─ Capacity Available ───────┤
     │                            │                             │                             │
     │                            │                             │── Insert Reservation ──────▶│
     │                            │                             │   (Token derived by HMAC)   │
     │                            │                             │                             │
     │◀───── Returns Hold Code ───┼─────────────────────────────┼─────────────────────────────┤
```

### Multi-Layer Locking Strategy
1. **Layer 1: Redis Distributed Lock**: Acquired on the key `revelis:lock:ticket_type:${ticketTypeId}` to serialize concurrent requests before hitting Postgres.
2. **Layer 2: Database Pessimistic Row Lock (`SELECT FOR UPDATE`)**: Lock acquired on `ticket_types` sorted alphabetically by UUID to prevent transaction deadlock.
3. **Layer 3: Unique Reservation Index**: A compound index on `(booking_order_id, ticket_type_id)` prevents duplicate reservations.
4. **Cleaners**: QStash cron workers poll for expired holds (beyond 15 minutes), transitioning them to `expired` and returning capacity back to `available`.

---

## 6. Booking System API

Booking orders manage the transaction checkout state machine from initiation to ticket delivery.

### State Machine Lifecycle
```
                 [POST /booking-orders]
                           │
                           ▼
                       ┌───────┐
                       │ Draft │
                       └───┬───┘
                           │ Allocation Success
                           ▼
                     ┌───────────┐
                     │  Pending  │
                     └─────┬─────┘
                           │ Payment Verified
                           ├───────────────────────────────┐
                           ▼                               ▼
                       ┌───────┐                      ┌─────────┐
                       │ Paid  │                      │ Expired │
                       └───┬───┘                      └────┬────┘
                           │ Deliver                           │ Late Capture
                           ▼                                   ▼
                      ┌─────────┐                     ┌────────────────┐
                      │ Booked  │                     │ Refund Pending │
                      └─────────┘                     └────────────────┘
```

- **Reconciliation**: Auto-reconciliation checks order items against generated `issued_tickets` to guarantee integrity.

---

## 7. Payments API (Razorpay)

Revelis operates a unified payments interface that supports dual-case callbacks.

### Dual-Case Parameter Normalization
The payment controllers parse parameters in either standard Web camelCase or Mobile SDK snake_case:
- `razorpayOrderId` / `razorpay_order_id`
- `razorpayPaymentId` / `razorpay_payment_id`
- `razorpaySignature` / `razorpay_signature`

### Verification Integrity
1. The server re-computes the HMAC hex digest locally using the active tenant's payment secret key:
   `HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, secret)`
2. The calculated value is compared via a timing-safe digest matcher (`timingSafeEqual`) to prevent timing side-channel attacks.
3. If matches, transactions are committed to the double-entry ledger, inventory reservations are converted to `booked`, and QStash is notified to issue tickets.

---

## 8. Ledger System API

All monetary transactions are written to an immutable double-entry ledger.

### Ledger Transaction Schema
- `id`: Unique UUID
- `tenantId`: Tenant owner mapping
- `sequenceNumber`: Linear monotonically increasing counter
- `previousHash`: SHA-256 hash of the preceding ledger transaction
- `currentHash`: SHA-256 hash computed on this transaction payload:
  `SHA256(previousHash + sequenceNumber + tenantId + JSON.stringify(entries))`
- `postedAt`: Timestamp of database commit

### Debits and Credits Accounting Rules
Debits must always equal Credits (`Σ Debits == Σ Credits`) for every transaction.

| Transaction Type | Debit Account | Credit Account | Invariant |
|---|---|---|---|
| **Ticket Purchase** | `PLATFORM_CLEARING` (Asset) | `PLATFORM_ESCROW` (Liability) | Gross ticket price + convenience fees |
| **Escrow Release** | `PLATFORM_ESCROW` (Liability) | `ORGANIZER_PENDING` (Liability) | Escrow balance transfers to organizer wallet |
| **Platform Commission**| `ORGANIZER_PENDING` (Liability) | `PLATFORM_REVENUE` (Equity) | Commission deduction (10% of subtotal) |
| **Tax Levy** | `PLATFORM_CLEARING` (Asset) | `TAX_PAYABLE` (Liability) | GST calculated on fees (18% of fees) |
| **Payout Execution** | `ORGANIZER_AVAILABLE` (Liability) | `PLATFORM_CLEARING` (Asset) | Moving cash out of ledger to organizer bank |

### Integrity Checks
Admin API exposes `/integrity-check` which runs a hash-chain verification from the genesis block (`0000000000000000000000000000000000000000000000000000000000000000`). If any ledger row is modified in the database, the hash-chain breaks, halting further postings.

---

## 9. Wallet System API

Organizer wallets represent withdrawable payouts, preventing cash-out before event execution.

### Wallet Lifecycles & Balances
- **Pending Balance**: Staged earnings from ticket sales. Stored in ledger as `ORGANIZER_PENDING`.
- **Available Balance**: Funds cleared and withdrawable. Moved from pending on event completion.
- **Locked/Frozen Balances**: Wallet funds are locked in state `processing` when a withdrawal request is pending approval, preventing double payouts.

---

## 10. Settlement Engine API

The settlement engine executes automated payout adjustments.

### Settlement Rules & Formulas
Upon Event Completion:
1. **Gross Sales calculation**: Sum of paid order subtotals.
2. **Platform Fees**: Platform Commission (10% of subtotals) + Convenience Fees (5% of subtotals).
3. **Tax Payable**: 18% GST calculated on Platform Fees.
4. **Organizer Net Share**:
   `Net Share = Gross Sales - Platform Commission`
5. **Ledger Update**: Moves Net Share from `ORGANIZER_PENDING` to `ORGANIZER_AVAILABLE`.

---

## 11. Refund System API

Refunds support partial cancellations and reverse double-entry balances.

### Reversal Logic & Late Capture Auto-Refunds
- **Eligibility Rules**: Tickets are refundable if `isRefundable` is true on the ticket type and the request occurs prior to the event's refund cutoff window.
- **Late Captures**: If a Razorpay payment arrives *after* the 15-minute booking hold has expired (late webhook capture), the system maintains the booking order as `expired`, marks the reservation as `refund_pending`, and triggers an immediate auto-refund API call to Razorpay.
- **Ledger Reversal**: Balanced journal entries reverse the original capture, debiting `PLATFORM_ESCROW` and crediting `PLATFORM_CLEARING` for the refunded quantity.

---

## 12. Webhooks System

Revelis processes external webhooks asynchronously.

### Security & Idempotency
- **Signature verification**: Razorpay headers (`X-Razorpay-Signature`) are parsed and validated against the local webhook secret.
- **Replay Safety**: Event IDs are logged in a database idempotency table. Webhook calls matching processed IDs return a `200 OK` immediate response (`duplicated: true`), skipping duplicate ledger postings.

---

## 13. Tax System API

Revelis implements tax reporting policies compliant with local regulations.

### Tax Formulas
- **Convenience Fee**: 5% of the ticket price.
- **Platform Commission**: 10% of the ticket price.
- **GST**: 18% calculated over the sum of fees.
  `GST = (Platform Commission + Convenience Fee) * 0.18`
- **Reversals**: Refund requests reverse GST calculations proportionally.

---

## 14. Error Handling System

All API errors return standard, controlled HTTP mappings inside the unified payload:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "fullName": ["fullName is required"]
    }
  },
  "meta": {
    "timestamp": "2026-06-23T14:15:00.000Z",
    "requestId": "req_8a883b2a"
  }
}
```

### Standard Error Codes

| Error Code | HTTP Status | Retryable? | Description |
|---|---|---|---|
| `BAD_REQUEST` | 400 | No | General malformed input or syntax error |
| `VALIDATION_ERROR` | 400 | No | Input payload did not pass Zod schema |
| `UNAUTHORIZED` | 401 | No | Token is missing, expired, or signature is invalid |
| `FORBIDDEN` | 403 | No | User lacks permissions required for RBAC role |
| `NOT_FOUND` | 404 | No | Resource could not be located |
| `CONFLICT` | 409 | No | Duplicate unique keys or resource conflict |
| `STALE_REQUEST` | 409 | Yes | Last updatedAt mismatch (optimistic locking block) |
| `RATE_LIMITED` | 429 | Yes | Client exceeded request rate quota |
| `DATABASE_ERROR` | 500 / 503 | Yes | Database connectivity lost or query crashed |
| `INTERNAL_SERVER_ERROR` | 500 | Yes | General unhandled server crash |

---

## 15. Rate Limits & Safety

The API employs rate limiting middleware built with sliding-window counters:
- **Global limit**: 60 requests per minute per IP.
- **Booking checkout limit**: 10 checkouts per minute per IP.
- **Webhooks/Payment verification limit**: 120 calls per minute.
- **Fraud protection**: Multiple failed payment attempts block further requests from that IP for 30 minutes.

---

## 16. API Versioning

- **Router prefixing**: All endpoints follow the `/` base mount (e.g. `/auth/login`, `/payments/verify`).
- **v1 Rules**: Current APIs represent the v1 contract.
- **Deprecation**: Deprecated APIs remain backward compatible and return the HTTP header:
  `X-API-Deprecation: true`

---

## 17. Full API Table Index

| Module | Endpoint | Method | Description | Auth | Notes |
|:---|:---|:---|:---|:---:|:---|
| **Auth** | `/auth/signup` | POST | Initiate new phone verify | Public | Resends OTP |
| **Auth** | `/auth/signup/verify` | POST | Verify SMS and persist user | Public | Returns tokens |
| **Auth** | `/auth/login` | POST | Authenticate password credentials | Public | Returns JWT |
| **Auth** | `/auth/refresh` | POST | Rotate expired access tokens | Public | Expects refresh token |
| **Auth** | `/auth/logout` | POST | Revoke refresh session | Public | - |
| **Auth** | `/auth/me` | GET | Load profile and roles | Required | - |
| **Tenants** | `/tenants` | POST | Instantiate workspace tenant | Required | Scoped to Owner |
| **Tenants** | `/tenants/:slug/members`| GET | List workspace members | Required | Admin role required |
| **Venues** | `/venues` | POST | Add physical venue capacity | Required | Manager permissions |
| **Events** | `/events` | POST | Create new event metadata | Required | Draft status |
| **Events** | `/events/:slug` | PATCH | Update event (or publish) | Required | Fires notification hooks |
| **Tickets** | `/ticket-types` | POST | Create tickets inventory tier | Required | Pessimistic checks |
| **Bookings**| `/booking-orders` | POST | Place booking hold reservation | Required | 15-minute TTL holds |
| **Bookings**| `/booking-orders/:id/assign`| POST | Populate attendee information | Required | Emits ticket issuance |
| **Payments**| `/payments/create-order` | POST | Create Razorpay order configuration | Required | Precomputes fees & tax |
| **Payments**| `/payments/verify` | POST | Local verify signature | Required | Commits ledger writes |
| **Payments**| `/payments/webhooks/razorpay`| POST | Webhook captures processor | Public | Signature-verified |
| **Ledger** | `/finance/accounts` | GET | List ledger trial accounts | Required | Admin role only |
| **Ledger** | `/finance/integrity-check` | GET | Chain cryptographic scan | Required | Hash sequence verify |
| **Ledger** | `/finance/projections/rebuild`| POST | Recompute balance projections | Required | Re-scans all journal blocks |
| **Wallet** | `/organizer/wallet` | GET | Load available balance | Required | Organizer scope |
| **Wallet** | `/organizer/withdrawals` | POST | Request payout release | Required | Locks withdrawable cash |
| **Refunds** | `/payments/refund` | POST | Issue ticket refund amount | Required | Admin approval required |

---

## 18. Examples Section

### Alice Signs Up and Verifies Phone

1. **Signup Start**
   ```bash
   curl -X POST http://localhost:3000/auth/signup/start \
     -H "Content-Type: application/json" \
     -d '{
       "fullName": "Alice Johnson",
       "username": "alicej",
       "email": "alice@example.com",
       "password": "SecurePassword123!",
       "phoneNumber": "+919999111234",
       "marketingOptIn": true
     }'
   ```
   **Response**:
   ```json
   {
     "success": true,
     "data": {
       "verificationSessionId": "c4d3b6f2-8c11-477c-a496-e2a27ff3644f"
     },
     "error": null,
     "meta": {
       "timestamp": "2026-06-23T14:10:00.000Z",
       "requestId": "req_8a883b2a"
     }
   }
   ```

2. **Verify OTP**
   ```bash
   curl -X POST http://localhost:3000/auth/signup/verify \
     -H "Content-Type: application/json" \
     -d '{
       "verificationSessionId": "c4d3b6f2-8c11-477c-a496-e2a27ff3644f",
       "code": "123456"
     }'
   ```
   **Response**:
   ```json
   {
     "success": true,
     "data": {
       "user": {
         "id": "usr_9f8e7d6c",
         "username": "alicej",
         "fullName": "Alice Johnson",
         "phoneNumber": "+919999111234"
       },
       "tokens": {
         "accessToken": "eyJhbGciOi...",
         "refreshToken": "eyJhbGciOi..."
       }
     },
     "error": null,
     "meta": {
       "timestamp": "2026-06-23T14:10:30.000Z",
       "requestId": "req_f8e7d6cba"
     }
   }
   ```

### Placing a Booking Reservation Hold
```bash
curl -X POST http://localhost:3000/booking-orders \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "x-tenant-slug: ahmedabad-navratri-tickets" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_3a4b5c6d",
    "items": [
      {
        "ticketTypeId": "tkt_8f9e0d1c",
        "quantity": 2
      }
    ]
  }'
```
**Response**:
```json
{
  "success": true,
  "data": {
    "id": "236194f9-d548-4bc0-9f13-40610e68ef10",
    "orderNumber": "ORD-2026-000412",
    "status": "pending",
    "totalAmount": 360000,
    "expiresAt": "2026-06-23T14:25:00.000Z"
  },
  "error": null,
  "meta": {
    "timestamp": "2026-06-23T14:10:00.000Z",
    "requestId": "req_2f3g4h5i"
  }
}
```

### Initiating Payment Order
```bash
curl -X POST http://localhost:3000/payments/create-order \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "x-tenant-slug: ahmedabad-navratri-tickets" \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "236194f9-d548-4bc0-9f13-40610e68ef10"
  }'
```
**Response**:
```json
{
  "success": true,
  "data": {
    "orderId": "order_OrFp1W66hB5B2v",
    "amount": 360000,
    "currency": "INR",
    "keyId": "rzp_test_active_key",
    "theme": {
      "color": "#3182ce"
    }
  },
  "error": null,
  "meta": {
    "timestamp": "2026-06-23T14:10:15.000Z",
    "requestId": "req_5h6i7j8k"
  }
}
```

### Verifying Payment Signature
```bash
curl -X POST http://localhost:3000/payments/verify \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "x-tenant-slug: ahmedabad-navratri-tickets" \
  -H "Content-Type: application/json" \
  -d '{
    "razorpay_order_id": "order_OrFp1W66hB5B2v",
    "razorpay_payment_id": "pay_mob_1781788",
    "razorpay_signature": "82a884faefea6b7a2d3c94892c99279a..."
  }'
```
**Response**:
```json
{
  "success": true,
  "data": {
    "bookingId": "236194f9-d548-4bc0-9f13-40610e68ef10",
    "status": "confirmed",
    "paymentStatus": "captured"
  },
  "error": null,
  "meta": {
    "timestamp": "2026-06-23T14:10:45.000Z",
    "requestId": "req_7i8j9k0l"
  }
}
```

### Unhandled Resource Validation Failure
```bash
curl -X POST http://localhost:3000/booking-orders \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "x-tenant-slug: ahmedabad-navratri-tickets" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_3a4b5c6d",
    "items": []
  }'
```
**Response (400 Bad Request)**:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "items": ["items must contain at least 1 ticket item"]
    }
  },
  "meta": {
    "timestamp": "2026-06-23T14:11:00.000Z",
    "requestId": "req_8j9k0l1m"
  }
}
```

---

## 19. Production Deployment

This section reflects the production hardening applied to make the backend
deployment-ready. It is authoritative for operating the service in production.

### 19.1 Runtime Requirements

- **Node.js 22** (Alpine image ships `node:22-alpine`).
- **PostgreSQL 14+** with SSL. Managed Postgres with PITR/WAL archiving is strongly recommended.
- **Redis** (Upstash REST or any ioredis-compatible server) for locks, rate limits, idempotency, and QStash replay dedup.
- **Cloudflare R2** (S3-compatible) for object storage.
- **Upstash QStash** for background jobs and recurring schedules.
- **Brevo** for transactional email, **Razorpay** for payments, **Twilio Verify** for OTP.
- `pg_dump` on PATH for the scheduled logical backup job (the image installs `postgresql-client`).

### 19.2 Build & Start

```bash
npm ci
npm run build      # tsc with noEmitOnError - fails the build on any type error
npm start          # node dist/index.js  (flat dist/, no .ts runtime imports)
```

The build compiles to a flat `dist/` (e.g. `dist/index.js`, `dist/db/migrate.js`) matching the Docker `CMD` and entrypoint.

### 19.3 Environment Variables

All variables are validated at boot (`src/config/env.ts`); production enforces a strict battery of checks. See `.env.production.example` for the full list. Notable additions:

| Variable | Default | Purpose |
|---|---|---|
| `RUN_MIGRATIONS` | `true` (compose) | Entrypoint applies Drizzle migrations before start. |
| `ALLOW_MOCK_PAYOUTS` | `false` | Must stay false in production; the built-in payout provider is a mock and will **fail** withdrawals unless explicitly opted in. Use the manual settlements flow instead. |
| `VIRUS_SCAN_PROVIDER` | `none` | With `none`, uploads are recorded as `unscanned` (honest) rather than a false `clean`. Wire a real provider before relying on scanning. |
| `DB_POOL_MAX` | `20` | Pool size - lower it when running many replicas against one DB. |
| `DB_IDLE_TIMEOUT` | `30` | Seconds before idle connections are recycled. |
| `DB_CONNECT_TIMEOUT` | `10` | Seconds to establish a new connection. |
| `DB_STATEMENT_TIMEOUT` | `30` | Seconds any single statement may run (slow-query pool-exhaustion guard). |
| `GRAFANA_ADMIN_PASSWORD` | - | Required by prod compose; no hardcoded default. |
| `CDN_BASE_URL`, `EMAIL_PUBLIC_URL`, `CORS_ORIGINS` | localhost/empty | **Must** be set to real public domains. |

### 19.4 Health, Readiness & Liveness

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Liveness - process is up. |
| `GET /health/startup` | Startup probe - returns 200 once fully booted. |
| `GET /health/ready` | Readiness - DB + Redis reachable. |
| `GET /health` | Deep multi-dependency check (DB, Redis, Twilio, Brevo, QStash, Razorpay, R2, worker/payment/reconciliation heartbeats). |
| `GET /metrics` | Prometheus metrics. **Network-restrict this** - it exposes a wallet-balance gauge. |

In production, an unreachable database at boot is fatal (the process exits) so a replica never reports healthy without its database.

### 19.5 Security Hardening

- **Security headers** on every response: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (TLS terminated upstream).
- **Request body-size limit** of 10 MB (large uploads use presigned R2 URLs). Oversized bodies get `413`.
- **`/cdn` serves only public objects** - any object with a non-public `storage_objects` record is refused (`404`); private assets must use the signed-download endpoint. Redirects are restricted to trusted hosts (no open redirect). `/cdn` is rate-limited.
- **Constant-time signature verification** for Razorpay checkout and webhooks; the webhook secret no longer falls back to the API secret.
- **Refunds** are serialized per transaction and carry a deterministic gateway idempotency key (no double-refund).
- **Payment webhooks** ask Razorpay to retry (`503`) rather than silently ACK when the Redis lock cannot be acquired and the event is not yet durably processed.
- **Distributed locks** are released with a fencing token (owner-checked compare-and-delete).
- **Logs are redacted** - secret/PII-looking keys (tokens, passwords, cards, OTPs, sessions) are replaced with `[REDACTED]`.
- The app trusts `X-Forwarded-For`/`CF-Connecting-IP`; run it **behind a trusted proxy** that strips client-supplied values.

### 19.6 Financial Integrity

- **Ledger is immutable at the DB level** (migration `0046`): `BEFORE UPDATE OR DELETE` triggers reject mutations on `ledger_entries`, `ledger_transactions`, and `ledger_audit_logs`; entry amounts must be `> 0`.
- **Hash chain is serialized per tenant** via a transaction-scoped advisory lock taken before the chain head is read, so concurrent postings cannot fork the chain.
- **Inventory oversell invariant** (migration `0045`): `sold_quantity + reserved_quantity <= total_quantity`. Consumer payment-confirm now decrements cached reserved and increments sold, and a scheduled reconciler repairs any drift.

> Migrations `0045`/`0046` add their new CHECK constraints as `NOT VALID` so they never fail on legacy rows; they are enforced for all new writes immediately. After the reconciler has repaired historical data you may `VALIDATE CONSTRAINT` them online.

### 19.7 Background Jobs & Schedules

Recurring jobs are **registered in code at startup** (`src/jobs/schedules.ts`, idempotent) - no out-of-band dashboard config required. They post to `${EMAIL_PUBLIC_URL}/qstash/jobs`:

| Job | Cron | Purpose |
|---|---|---|
| `expire_reservations` | every 5 min | Release expired holds (all tenants). |
| `reconcile_inventory` | hourly | Repair cached sold/reserved drift. |
| `process_email_outbox` | every min | Flush transactional email outbox (covers scale-to-zero). |
| `cleanup_orphans` | daily 02:00 | Remove orphaned storage objects. |
| `verify_storage_integrity` | daily 03:00 | Checksum-verify stored objects. |
| `financial_reconciliation` | daily 04:00 | Ledger/wallet reconciliation + integrity. |
| `db_backup` | daily 01:00 | Logical `pg_dump` backup to R2. |

The inbound handler records its replay-dedup key **only after success** and uses an in-progress lock, so a job that fails its first attempt is retried rather than silently dropped.

### 19.8 Backups & Recovery

- **Primary:** use the managed database provider's automated backups + PITR/WAL archiving. This is the recommended recovery strategy for a financial platform.
- **Secondary:** the `db_backup` schedule uploads a daily `pg_dump` custom-format archive to `backups/` in R2. Requires `pg_dump` (installed in the image) and R2 credentials. On the hardened prod compose, the read-only rootfs uses a 64 MB `/tmp` tmpfs - raise it if dumps exceed that.
- **Restore:** `pg_restore` the downloaded archive into a fresh database, then start with `RUN_MIGRATIONS=true`.

### 19.9 Docker

```bash
docker build -t revelis-backend .
docker compose -f docker-compose.prod.yml up -d
```

The runner is non-root, read-only rootfs with tmpfs, drops all capabilities, sets `no-new-privileges`, pins resource limits, and ships a native-Node healthcheck. `RUN_MIGRATIONS` defaults to `true` in the prod compose so migrations apply on deploy.

### 19.10 Cloud Deployment

Stateless HTTP app binding `0.0.0.0:$PORT`; externalize Postgres/Redis/R2/QStash. Suitable for Railway, Render, Fly.io, DigitalOcean, AWS ECS/EC2, GCP Cloud Run, Azure, and Kubernetes. Front with TLS + a trusted proxy and set the public-domain env vars. On scale-to-zero platforms the recurring QStash schedules (not the in-process timers) drive cron work - they are registered automatically at boot.

### 19.11 Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Build fails | Type error - `noEmitOnError` blocks emit. Run `npx tsc --noEmit`. |
| Boots then exits in prod | Database unreachable at startup (intentional hard fail). Check `DATABASE_URL`/network. |
| Withdrawals fail with "No production payout provider" | Expected - use manual settlements, or set `ALLOW_MOCK_PAYOUTS` only if you understand it does not move money. |
| `/cdn` returns 404 for a private file | By design - fetch private assets via the signed-download endpoint. |
| Recurring jobs not running | `QSTASH_TOKEN` unset, or `EMAIL_PUBLIC_URL` is loopback (schedules are skipped for local addresses). |
| `413` on requests | Body exceeds the 10 MB limit - use presigned R2 uploads for large files. |
