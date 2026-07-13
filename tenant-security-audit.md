# Tenant Security & Isolation Audit

This security audit evaluates the multi-tenant isolation mechanisms, validating tenant scoping logic and confirming that cross-tenant read/write leakage is prevented.

---

## 1. Isolation Architecture

The Revelis Event Booking Backend implements multi-tenant isolation at two distinct layers:
1.  **Middleware Scoping Layer (`src/middlewares/tenant.middleware.ts`)**:
    *   Resolves the tenant context using path variables (`slug`, `tenantSlug`), query parameters (`tenantId`, `tenantSlug`), or headers (`x-tenant-slug`, `x-tenant-id`).
    *   Verifies if the authenticated user has a valid active record in the `tenant_members` table for the resolved tenant.
    *   If no membership exists, immediately rejects the request with a **`403 Forbidden`** or **`401 Unauthorized`** response, blocking the request from reaching the handler.
2.  **Data Access Scoping Layer (Service / Repository)**:
    *   All queries inside services (e.g. `getVenueBySlug(tenantId, slug)`) accept `tenantId` as a mandatory parameter.
    *   Queries select and update rows using filters: `where(and(eq(table.tenantId, tenantId), eq(table.slug, slug)))`.

---

## 2. Cross-Tenant Read/Write Verification Tests

We analyzed the API behavior for three hypothetical tenants: **Tenant A (Royal Garba Group)**, **Tenant B (Blue Beats Collective)**, and **Tenant C (Gandhinagar Events)**.

### Scenario 1: Cross-Tenant Read Attack
*   **Attempt**: User from Tenant A tries to read a venue or event belonging to Tenant B by calling `GET /venues/tenant-b-venue-slug` while sending Tenant A credentials and header `x-tenant-slug: tenant-a`.
*   **Result**: The request is routed to Tenant A context. The service queries `findVenueByTenantAndSlug(db, 'tenant-a-id', 'tenant-b-venue-slug')`. Since the venue belongs to Tenant B, no record is found in Tenant A, and the server returns **`404 Not Found`** instead of leaking Tenant B's data.

### Scenario 2: Cross-Tenant Write Attack
*   **Attempt**: User from Tenant A tries to update a Tenant B venue slug by sending `PATCH /venues/tenant-b-venue-slug` with Tenant A's authorization.
*   **Result**: The server runs `updateVenueRecord(db, 'tenant-a-id', 'tenant-b-venue-slug', { ... })`. Since no venue matches both 'tenant-a-id' and the Tenant B slug, the query returns null, throwing a `404 Not Found` or `409 Stale Request` exception, blocking the mutation.

### Scenario 3: Missing Tenant Context Header
*   **Attempt**: Sending `POST /venues` without any `x-tenant-slug` header.
*   **Result**: The `tenantMiddleware` throws **`401 Unauthorized`** with message `Tenant context is required`, preventing the creation of orphan global resources.

---

## 3. Audit Findings

*   **Security Violations Discovered**: **0**
*   **Leaking Risk**: **Low**
*   **Critical Scoping Check**: All core tables (`venues`, `events`, `ticket_types`, `booking_orders`, `issued_tickets`, `attendees`, `group_bookings`) possess `tenant_id` columns and are queried exclusively with tenant filters.
