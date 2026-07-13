# Module: Authentication Endpoints

### 1. Signup Start
- **Method**: `POST`
- **Route**: `/auth/signup/start`
- **Authentication**: None
- **Body Schema**:
  - `fullName`: string (min 2, max 100)
  - `username`: string (min 3, max 50)
  - `email`: string (valid email format)
  - `password`: string (min 12, upper, lower, number, special)
  - `phoneNumber`: string (E.164)
- **Request Body Example**:
```json
{
  "fullName": "John Doe",
  "username": "johndoe_123",
  "email": "johndoe@example.com",
  "password": "StrongPassword123!",
  "phoneNumber": "+14155550199",
  "marketingOptIn": true
}
```
- **Success Response (201 Created)**:
```json
{
  "success": true,
  "message": "Verification OTP sent successfully",
  "data": {
    "verificationSessionId": "session_8a883b2a-f8f4-42cc-971c-3b9ff0123456"
  }
}
```

### 2. Signup Verify
- **Method**: `POST`
- **Route**: `/auth/signup/verify`
- **Authentication**: None
- **Body Schema**:
  - `verificationSessionId`: string (UUID)
  - `code`: string (OTP)
- **Success Response (201 Created)**:
```json
{
  "success": true,
  "message": "Verification successful",
  "data": {
    "user": {
      "id": "usr_8c01b2a9",
      "username": "johndoe_123",
      "fullName": "John Doe",
      "phoneNumber": "+14155550199"
    },
    "tokens": {
      "accessToken": "jwt_access_token",
      "refreshToken": "jwt_refresh_token"
    }
  }
}
```
