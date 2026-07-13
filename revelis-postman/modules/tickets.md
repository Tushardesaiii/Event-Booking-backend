# Module: Ticket Types

Allows tenant managers to create pricing tiers and manage general admissions.

### Create Ticket Type
- **Method**: `POST`
- **Route**: `/ticket-types`
- **Headers**: `x-tenant-slug` & `Authorization`
- **Body**:
```json
{
  "eventId": "ev_royal_garba",
  "name": "VIP pass",
  "description": "Access to premium VIP enclosure and parking.",
  "price": 2500,
  "capacity": 500,
  "saleStartDateTime": "2026-06-11T13:30:00.000Z",
  "saleEndDateTime": "2026-10-16T13:30:00.000Z",
  "minQtyPerOrder": 1,
  "maxQtyPerOrder": 4,
  "isActive": true
}
```
