# Module: Events Management

Handles creation, category categorization, series, and indexing search filters.

### Create Event
- **Method**: `POST`
- **Route**: `/events`
- **Authentication**: Bearer Required
- **Tenant Context**: Required (`x-tenant-slug`)
- **Body**:
```json
{
  "title": "Royal Garba Night 2026",
  "shortDescription": "Premium Garba night with celebrity artists",
  "description": "Royal Garba Night 2026 at SG Highway arena in Ahmedabad.",
  "startDateTime": "2026-10-16T14:00:00.000Z",
  "endDateTime": "2026-10-16T20:00:00.000Z",
  "timezone": "Asia/Kolkata",
  "status": "draft",
  "visibility": "public",
  "venueId": "vn_gmdc",
  "categoryId": "cat_navratri",
  "maxCapacity": 10000,
  "isFeatured": true,
  "tagIds": []
}
```
- **Success Response (201)**:
```json
{
  "success": true,
  "message": "Event created successfully",
  "data": {
    "id": "ev_royal_garba",
    "title": "Royal Garba Night 2026",
    "slug": "royal-garba-night-2026",
    "status": "draft",
    "visibility": "public"
  }
}
```
