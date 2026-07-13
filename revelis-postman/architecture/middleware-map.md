# Middleware Map

The standard middleware execution pipeline inside Hono:

1. **Request Logger Middleware**: Logs request details.
2. **Error Handling Middleware**: Formats and sanitizes error structures.
3. **Correlation ID Handler**: Generates/passes `x-request-id` and `x-correlation-id`.
4. **CORS Middleware**: Validates Origin whitelist.
5. **Auth Middleware**: Extracts Bearer token, verifies JWT session state.
6. **Tenant Middleware**: Resolves tenant scope via parameter or headers.
7. **RBAC Middleware**: Restricts access to roles/permissions.
8. **Validation Middleware**: Safely parses body/query schemas using Zod.
