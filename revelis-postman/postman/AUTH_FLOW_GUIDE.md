# Revelis Authentication Lifecycle Guide

Revelis utilizes a two-step OTP validation flow for phone signup and email verify:

```mermaid
sequenceDiagram
    participant Developer as API Client
    participant Auth as Auth Router
    participant Twilio as Twilio OTP Service
    participant DB as Postgres DB

    Developer->>Auth: POST /auth/signup/start (Phone, Email, Pass)
    Auth->>DB: Create Verification Session (pending)
    Auth->>Twilio: Dispatch SMS Code
    Auth-->>Developer: Return verificationSessionId
    Developer->>Auth: POST /auth/signup/verify (verificationSessionId, code="123456")
    Auth->>DB: Complete verification session & create User & Active Session
    Auth-->>Developer: Return User payload & Access Token + Refresh Token
```

### Pre-configured Automation Script
All authentication folders have been enriched with Postman test scripts that parse response payloads and update `{{token}}` and `{{refreshToken}}` variables.
