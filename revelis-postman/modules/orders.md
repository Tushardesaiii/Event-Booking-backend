# Module: Booking Orders & Ticket Fulfillment

Manages reservations, order processing, and scan entry validations.

- `POST /booking-orders`: Initiate booking order hold.
- `POST /booking-orders/:orderNumber/assign-attendees`: Finalize ticket attendee assignments.
- `POST /issued-tickets/validate`: QR Scanner entry checker.
- `POST /issued-tickets/:ticketNumber/check-in`: Complete check-in validation.
