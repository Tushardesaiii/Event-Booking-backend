# Security Observations Report

## 1. Authentication Review
All endpoints except `/health` and `/auth/signup/login` endpoints require Bearer JWT token validations. Access tokens are short-lived.

## 2. Multi-Tenant Isolation
Tenant context is successfully enforced via `tenantMiddleware` by checking `x-tenant-slug`. Tenant cross-contamination is prevented by checking memberships on every read/write.

## 3. Concurrency Safety (Optimistic Locking)
Mutation routes check the `lastKnownUpdatedAt` field to protect against overwrite collisions.
