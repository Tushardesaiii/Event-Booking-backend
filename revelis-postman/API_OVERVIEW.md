# API Architectural Overview

The Revelis Backend is built on **Hono**, running on NodeJS. It uses **Drizzle ORM** for PostgreSQL connection and database schema.

## Key Features

- **Strict Multi-Tenant Isolation**: Scoped via `x-tenant-slug` header validation middleware. Cross-tenant reads/writes throw `404 Not Found` or `403 Forbidden`.
- **Bearer Token Auth**: Sessions are tracked via Database storage with JWT Access (short-lived) and Refresh (long-lived) tokens.
- **Optimistic Locking**: Mutation endpoints (e.g. venues and events updates/deletions) utilize `lastKnownUpdatedAt` optimistic locking checks to safeguard concurrent requests.
- **Drizzle Database Schema**: All tables use automated schema relations.

## General Response Standards
Successful requests:
```json
{
  "success": true,
  "message": "Resource created successfully",
  "data": { ... }
}
```

Failures:
```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_FAILED",
    "details": { ... }
  }
}
```
