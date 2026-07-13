# Route Dependencies & Parent-Child Relationships

To test event and ticket bookings successfully, endpoints must be called in a strict order:

```
1. User Signup/Login (/auth)
   └─> 2. Create Tenant (/tenants)
        ├─> 3. Create Venue (/venues)
        └─> 4. Create Category (/event-categories)
             └─> 5. Create Event (/events)
                  ├─> 6. Create Ticket Type (/ticket-types)
                  │    └─> 7. Book Ticket Order (/booking-orders)
                  │         └─> 8. Assign Attendees (/booking-orders/:orderNumber/assign-attendees)
                  │              └─> 9. Check in Attendee (/issued-tickets/:ticketNumber/check-in)
                  └─> 10. Add Artist Event (/artists/:artistSlug/events/:eventSlug)
```
