# Revelis API Platform Package

This directory contains the production-ready API documentation, environments, workflows, testing scripts, and Postman collections for the **Revelis Event Booking Platform**.

### Directory Structure

```
revelis-postman/
├── README.md                  # Quick-start guide for onboarding
├── API_OVERVIEW.md            # Architecture context and specs
├── API_CHANGELOG.md           # Route registration log
├── postman/
│   ├── Revelis.postman_collection.json            # Collection v2.1.0
│   ├── Revelis_Local.postman_environment.json      # Local env
│   ├── Revelis_Development.postman_environment.json
│   ├── Revelis_Staging.postman_environment.json
│   └── Revelis_Production.postman_environment.json
│   └── AUTH_FLOW_GUIDE.md        # Comprehensive Authentication flow
├── modules/                   # Domain specific endpoint docs
├── workflows/                 # Standard business workflow scenarios
├── testing/                   # Newman and local testing run guides
├── architecture/              # Route maps, Middlewares, Validation, and Dependencies
├── audit/                     # Audit logs, coverage reports, quality gates
└── generated/                 # Machine-readable schema JSON metadata
```

## 🚀 5-Minute Developer Quick Start

1. **Import the Collection & Environment**:
   - Open Postman -> Click **Import** -> Select [Revelis.postman_collection.json](file:///d:/SpeedMVPs/Event-booking-backend/revelis-postman/postman/Revelis.postman_collection.json).
   - Select [Revelis_Local.postman_environment.json](file:///d:/SpeedMVPs/Event-booking-backend/revelis-postman/postman/Revelis_Local.postman_environment.json) to configure your environment variables.
2. **Select Active Environment**:
   - In the top-right dropdown, select **Revelis_Local**.
3. **Execute Signup or Login Flow**:
   - Go to **Authentication** folder -> Run **auth signup start**.
   - Input your phone number and email.
   - Run **auth signup verify** with code `123456`. The access token will automatically extract and bind to your environment variables!
4. **Trigger Testing Suite**:
   - You can run the entire collection or specific folders using **Postman Collection Runner** or Newman CLI.
