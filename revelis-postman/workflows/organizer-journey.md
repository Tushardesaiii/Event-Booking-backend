# Workflow: Organizer Journey

```mermaid
graph TD
    A[Signup & Login] --> B[Create Tenant Workspace]
    B --> C[Create Venue]
    C --> D[Create Event Category]
    D --> E[Create Event Draft]
    E --> F[Create Ticket Types]
    F --> G[Publish Event]
    G --> H[View Dashboard Analytics]
```

### API Executions:
1. `POST /auth/login` -> Gets access token.
2. `POST /tenants` -> Creates tenant & binds slug.
3. `POST /venues` -> Creates physical location.
4. `POST /events` -> Creates event in 'draft' state.
5. `POST /ticket-types` -> Adds VIP and General Admission pricing.
6. `PATCH /events/:slug` -> Changes state to 'published'.
