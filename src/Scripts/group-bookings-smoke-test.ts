import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { groupBookings } from '../modules/group-bookings/schema.js';
import {
  bookingOrderItems,
  bookingOrders,
  ticketTypes,
  issuedTickets,
  notifications,
  groupBookingActivity,
  groupBookingMembers
} from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import inventory from '../modules/inventory/service.js';

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_TEST_VERBOSE || 'false');

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

interface RequestResult {
  status: number;
  ok: boolean;
  data: any;
  raw: string;
}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const extra = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${extra}`);
  }
}

async function request(path: string, options: RequestOptions = {}): Promise<RequestResult> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const raw = await response.text();
  let data: any = null;

  if (raw.trim().length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (VERBOSE) {
    console.log(`${response.status} ${options.method ?? 'GET'} ${path}`);
    if (raw.trim()) {
      console.log(raw);
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    raw
  };
}

async function signupUser(username: string) {
  const ts = Date.now() + Math.floor(Math.random() * 1000000);
  const randDigits = String(Math.floor(1000000 + Math.random() * 9000000));
  const payload = {
    username: `${username}_${ts}`,
    fullName: `${username} User`,
    email: `${username}_${ts}@example.com`,
    password: 'StrongPassword123!',
    phoneNumber: `+1415${randDigits}`
  };
  const startRes = await request('/auth/signup/start', {
    method: 'POST',
    body: payload
  });
  assert(startRes.status === 201, `Signup start failed for ${username}`, startRes.data);
  const startResult = startRes.data.data;

  const verifyRes = await request('/auth/signup/verify', {
    method: 'POST',
    body: {
      verificationSessionId: startResult.verificationSessionId,
      code: '123456'
    }
  });
  assert(verifyRes.status === 201, `Signup verify failed for ${username}`, verifyRes.data);
  return verifyRes.data.data;
}

async function run() {
  console.log('GROUP BOOKINGS SMOKE TEST START\n');
  console.log(`Base URL: ${BASE_URL}`);

  // 1. SIGNUP USERS
  const ownerAuth = await signupUser('gb_owner');
  const member1Auth = await signupUser('gb_member1');
  const member2Auth = await signupUser('gb_member2');
  const member3Auth = await signupUser('gb_member3');
  const strangerAuth = await signupUser('gb_stranger');
  console.log('✓ Users created');

  // 2. CREATE TENANT
  const tenantRes = await request('/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
    body: {
      name: `GB Tenant ${Date.now()}`,
      description: 'Tenant for group bookings testing'
    }
  });
  assert(tenantRes.status === 201, 'Tenant creation failed', tenantRes.data);
  const tenant = tenantRes.data.data;
  console.log('✓ Tenant created');

  // Add members to tenant
  const addMembers = [member1Auth, member2Auth, member3Auth];
  for (const member of addMembers) {
    const addRes = await request(`/tenants/${tenant.slug}/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAuth.tokens.accessToken}` },
      body: {
        userId: member.user.id,
        role: 'viewer'
      }
    });
    assert(addRes.status === 201, `Member add to tenant failed for ${member.user.username}`, addRes.data);
  }
  console.log('✓ Members added');

  const ownerHeaders = {
    Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };
  const member1Headers = {
    Authorization: `Bearer ${member1Auth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };
  const member2Headers = {
    Authorization: `Bearer ${member2Auth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };
  const member3Headers = {
    Authorization: `Bearer ${member3Auth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };
  const strangerHeaders = {
    Authorization: `Bearer ${strangerAuth.tokens.accessToken}`,
    'x-tenant-slug': tenant.slug
  };

  // 3. CREATE VENUE
  const venueRes = await request('/venues', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      name: 'GB Dome Ahmedabad',
      addressLine1: 'SG Road',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      capacity: 1000
    }
  });
  assert(venueRes.status === 201, 'Venue creation failed', venueRes.data);
  const venue = venueRes.data.data;
  console.log('✓ Venue created');

  // 4. CREATE EVENT
  const eventRes = await request('/events', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      title: 'GB Navratri 2026',
      shortDescription: 'Garba night',
      description: 'Garba night load testing',
      startDateTime: '2026-10-16T14:00:00.000Z',
      endDateTime: '2026-10-17T05:30:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'published',
      visibility: 'public',
      venueId: venue.id,
      isFeatured: true
    }
  });
  assert(eventRes.status === 201, 'Event creation failed', eventRes.data);
  const event = eventRes.data.data;
  console.log('✓ Event created');

  // 5. CREATE TICKET TYPE
  const ticketRes = await request('/ticket-types', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      eventId: event.id,
      name: 'Couple Pass',
      price: 2000,
      totalQuantity: 100,
      status: 'active',
      visibility: 'public',
      currency: 'INR',
      taxBehavior: 'exclusive',
      soldQuantity: 0,
      reservedQuantity: 0,
      minPerOrder: 1,
      maxPerOrder: 10
    }
  });
  assert(ticketRes.status === 201, 'Ticket type creation failed', ticketRes.data);
  const ticketType = ticketRes.data.data;
  console.log('✓ Ticket type created');


  console.log('\nRUNNING SCENARIO 1: HAPPY PATH & BOUNDARY VALIDATIONS...');

  // 6. CREATE GROUP BOOKING (4 Couple Passes, total amount = 8000)
  const createGBRes = await request('/group-bookings', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      eventId: event.id,
      ticketSelections: [
        { ticketTypeId: ticketType.id, quantity: 4 }
      ],
      title: 'College Garba Gang'
    }
  });
  assert(createGBRes.status === 201, 'Group booking creation failed', createGBRes.data);
  const gb = createGBRes.data.data;
  assert(Number(gb.totalAmount) === 8000, 'Total amount mismatch', gb);
  assert(gb.status === 'active', 'Initial status should be active', gb);
  console.log('✓ Group booking created');

  // ASSERT INVENTORY RESERVED
  await inventory.reconcileCachedInventory(db, { tenantId: tenant.id, ticketTypeIds: [ticketType.id], repair: true });
  let tt = await db.select().from(ticketTypes).where(eq(ticketTypes.id, ticketType.id));
  assert(tt.length > 0, 'Ticket type not found in DB');
  assert(tt[0].reservedQuantity === 4, `Reserved quantity should be 4, got ${tt[0].reservedQuantity}`);
  console.log('✓ Inventory reserved quantity verified (quantity = 4)');

  // 7. DUPLICATE INVITATION TESTS
  const inviteRes1 = await request(`/group-bookings/${gb.id}/invite`, {
    method: 'POST',
    headers: ownerHeaders,
    body: { userId: member1Auth.user.id }
  });
  assert(inviteRes1.status === 201, `Member invite failed for member1`, inviteRes1.data);

  // Invite again -> Should return 409 Conflict
  const inviteRes2 = await request(`/group-bookings/${gb.id}/invite`, {
    method: 'POST',
    headers: ownerHeaders,
    body: { userId: member1Auth.user.id }
  });
  assert(inviteRes2.status === 409, `Duplicate invite should fail with 409 Conflict, got ${inviteRes2.status}`);

  // Verify duplicate member record not created in DB
  const mem1Records = await db.select().from(groupBookingMembers).where(and(eq(groupBookingMembers.groupBookingId, gb.id), eq(groupBookingMembers.userId, member1Auth.user.id)));
  assert(mem1Records.length === 1, `Should only have exactly 1 member record, found ${mem1Records.length}`);
  console.log('✓ Duplicate invitation blocked and verified');

  // Invite other members
  await request(`/group-bookings/${gb.id}/invite`, { method: 'POST', headers: ownerHeaders, body: { userId: member2Auth.user.id } });
  await request(`/group-bookings/${gb.id}/invite`, { method: 'POST', headers: ownerHeaders, body: { userId: member3Auth.user.id } });
  console.log('✓ Invitations sent');

  // 8. OWNER RESTRICTIONS
  // Non-owner (member1) tries to invite
  const badInvite = await request(`/group-bookings/${gb.id}/invite`, {
    method: 'POST',
    headers: member1Headers,
    body: { userId: strangerAuth.user.id }
  });
  assert(badInvite.status === 403, `Non-owner invite should return 403, got ${badInvite.status}`);

  // Non-owner (member1) tries to remove member
  const badRemove = await request(`/group-bookings/${gb.id}/members?userId=${member2Auth.user.id}`, {
    method: 'DELETE',
    headers: member1Headers
  });
  assert(badRemove.status === 403, `Non-owner remove member should return 403, got ${badRemove.status}`);

  // Non-owner (member1) tries to rebalance shares
  const badRebalance = await request(`/group-bookings/${gb.id}/share`, {
    method: 'PATCH',
    headers: member1Headers,
    body: {
      shares: [{ userId: ownerAuth.user.id, amount: 8000 }],
      lastKnownUpdatedAt: gb.updatedAt
    }
  });
  assert(badRebalance.status === 403, `Non-owner share rebalance should return 403, got ${badRebalance.status}`);

  // Non-owner (member1) tries to cancel
  const badCancel = await request(`/group-bookings/${gb.id}/cancel`, {
    method: 'POST',
    headers: member1Headers,
    body: { lastKnownUpdatedAt: gb.updatedAt }
  });
  assert(badCancel.status === 403, `Non-owner cancel should return 403, got ${badCancel.status}`);
  console.log('✓ Non-owner restrictions (403 Forbidden) verified');

  // 9. ACCEPT & DECLINE INVITES
  const accept1Res = await request(`/group-bookings/${gb.id}/accept`, { method: 'POST', headers: member1Headers });
  assert(accept1Res.status === 200, 'Member 1 accept failed');

  const accept2Res = await request(`/group-bookings/${gb.id}/accept`, { method: 'POST', headers: member2Headers });
  assert(accept2Res.status === 200, 'Member 2 accept failed');

  const decline3Res = await request(`/group-bookings/${gb.id}/decline`, { method: 'POST', headers: member3Headers });
  assert(decline3Res.status === 200, 'Member 3 decline failed');
  console.log('✓ Accept/decline verified');

  // Get current details to verify updated state and timestamps
  const detailRes = await request(`/group-bookings/${gb.id}`, { headers: ownerHeaders });
  assert(detailRes.status === 200, 'Get details failed');
  const gbDetail = detailRes.data.data;

  // 10. SHARE REBALANCING
  // Owner rebalances (Owner = 2000, Member 1 = 3000, Member 2 = 3000, sum = 8000)
  const rebalanceRes = await request(`/group-bookings/${gb.id}/share`, {
    method: 'PATCH',
    headers: ownerHeaders,
    body: {
      shares: [
        { userId: ownerAuth.user.id, amount: 2000 },
        { userId: member1Auth.user.id, amount: 3000 },
        { userId: member2Auth.user.id, amount: 3000 }
      ],
      lastKnownUpdatedAt: gbDetail.updatedAt
    }
  });
  assert(rebalanceRes.status === 200, 'Rebalance failed', rebalanceRes.data);
  console.log('✓ Share rebalance verified');

  // 11. OCC HARDENING
  const currentGB = (await request(`/group-bookings/${gb.id}`, { headers: ownerHeaders })).data.data;
  const bookingOrderId = currentGB.bookingOrderId;

  // Fetch items from the database directly
  const boItems = await db.select().from(bookingOrderItems).where(eq(bookingOrderItems.bookingOrderId, bookingOrderId));
  assert(boItems.length > 0, 'No booking order items found');
  const itemId = boItems[0].id;

  // Stale rebalance -> 409
  const staleRebalance = await request(`/group-bookings/${gb.id}/share`, {
    method: 'PATCH',
    headers: ownerHeaders,
    body: {
      shares: [
        { userId: ownerAuth.user.id, amount: 2000 },
        { userId: member1Auth.user.id, amount: 3000 },
        { userId: member2Auth.user.id, amount: 3000 }
      ],
      lastKnownUpdatedAt: '2000-01-01T00:00:00.000Z'
    }
  });
  assert(staleRebalance.status === 409, 'OCC rebalance should fail with 409 STALE_REQUEST');

  // Stale member removal -> 409
  const staleRemove = await request(`/group-bookings/${gb.id}/members?userId=${member2Auth.user.id}&lastKnownUpdatedAt=2000-01-01T00:00:00.000Z`, {
    method: 'DELETE',
    headers: ownerHeaders
  });
  assert(staleRemove.status === 409, 'OCC member removal should fail with 409 STALE_REQUEST');

  // Stale contribution -> 409
  const staleContribute = await request(`/group-bookings/${gb.id}/contribute`, {
    method: 'POST',
    headers: member1Headers,
    body: {
      amount: 500,
      lastKnownUpdatedAt: '2000-01-01T00:00:00.000Z'
    }
  });
  assert(staleContribute.status === 409, 'OCC contribution should fail with 409 STALE_REQUEST');

  // Stale attendee assignment -> 409
  const staleAssign = await request(`/group-bookings/${gb.id}/assign-attendees`, {
    method: 'POST',
    headers: member1Headers,
    body: {
      assignments: [
        { bookingOrderItemId: itemId, attendee: { fullName: 'X1', email: 'x1@x.com', phone: '+1234567890' } }
      ],
      lastKnownUpdatedAt: '2000-01-01T00:00:00.000Z'
    }
  });
  assert(staleAssign.status === 409, 'OCC attendee assignment should fail with 409 STALE_REQUEST');
  console.log('✓ Concurrency (OCC) hardening checks verified');

  // 12. UNDER-CONTRIBUTION TESTS
  // Member 1 contributes 1500 (under total share of 3000)
  const pay1Res = await request(`/group-bookings/${gb.id}/contribute`, {
    method: 'POST',
    headers: member1Headers,
    body: { amount: 1500, lastKnownUpdatedAt: currentGB.updatedAt }
  });
  assert(pay1Res.status === 200, 'Member 1 partial pay failed');

  // Verify group is still active and order is pending
  const checkUnderGB = (await request(`/group-bookings/${gb.id}`, { headers: ownerHeaders })).data.data;
  assert(checkUnderGB.status === 'active', 'Booking must remain active when under-paid');
  const checkUnderOrder = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId));
  assert(checkUnderOrder[0].status === 'pending', 'Booking order must remain pending when under-paid');
  console.log('✓ Under-contribution active state checks verified');

  // 13. OVER-CONTRIBUTION TESTS
  // Member 1 has paid 1500 of 3000 share. Remaining share allocation is 1500.
  // Member 1 attempts to pay 2000. -> Should fail with 400 Bad Request
  const overPayRes = await request(`/group-bookings/${gb.id}/contribute`, {
    method: 'POST',
    headers: member1Headers,
    body: { amount: 2000, lastKnownUpdatedAt: checkUnderGB.updatedAt }
  });
  assert(overPayRes.status === 400, `Over-contribution should be rejected with 400, got ${overPayRes.status}`, overPayRes.data);
  console.log('✓ Over-contribution limit block verified');

  // 14. ATTENDEE SECURITY TESTS
  // Member 1 cannot assign attendees beyond remaining share (share = 3000, price = 2000, limit = ceil(3000/2000) = 2)
  const overLimitAssign = await request(`/group-bookings/${gb.id}/assign-attendees`, {
    method: 'POST',
    headers: member1Headers,
    body: {
      assignments: [
        { bookingOrderItemId: itemId, attendee: { fullName: 'A1', email: 'a1@x.com', phone: '+1234567890' } },
        { bookingOrderItemId: itemId, attendee: { fullName: 'A2', email: 'a2@x.com', phone: '+1234567890' } },
        { bookingOrderItemId: itemId, attendee: { fullName: 'A3', email: 'a3@x.com', phone: '+1234567890' } }
      ],
      lastKnownUpdatedAt: checkUnderGB.updatedAt
    }
  });
  assert(overLimitAssign.status === 409, `Over limit attendee assignment should return 409, got ${overLimitAssign.status}`);

  // Stranger cannot assign attendees
  const strangerAssign = await request(`/group-bookings/${gb.id}/assign-attendees`, {
    method: 'POST',
    headers: strangerHeaders,
    body: {
      assignments: [
        { bookingOrderItemId: itemId, attendee: { fullName: 'S1', email: 's1@x.com', phone: '+1234567890' } }
      ],
      lastKnownUpdatedAt: checkUnderGB.updatedAt
    }
  });
  assert(strangerAssign.status === 403, `Stranger attendee assignment should return 403, got ${strangerAssign.status}`);
  console.log('✓ Attendee assignment security checks verified');

  // Assign valid number of attendees (2) for Member 1
  const validAssign = await request(`/group-bookings/${gb.id}/assign-attendees`, {
    method: 'POST',
    headers: member1Headers,
    body: {
      assignments: [
        { bookingOrderItemId: itemId, attendee: { fullName: 'A1', email: 'a1@x.com', phone: '+1234567891' } },
        { bookingOrderItemId: itemId, attendee: { fullName: 'A2', email: 'a2@x.com', phone: '+1234567892' } }
      ],
      lastKnownUpdatedAt: checkUnderGB.updatedAt
    }
  });
  assert(validAssign.status === 200, 'Valid assignment failed', validAssign.data);
  console.log('✓ Attendee limits verified');

  // Get current update timestamp for contribution re-check
  const postAssignGB = (await request(`/group-bookings/${gb.id}`, { headers: ownerHeaders })).data.data;

  // Complete payments (Member 1 pays remaining 1500, Member 2 pays 3000, Owner pays 2000)
  const pay2Res = await request(`/group-bookings/${gb.id}/contribute`, {
    method: 'POST',
    headers: member1Headers,
    body: { amount: 1500, lastKnownUpdatedAt: postAssignGB.updatedAt }
  });
  assert(pay2Res.status === 200, 'Member 1 remaining payment failed');

  const postPay2GB = (await request(`/group-bookings/${gb.id}`, { headers: ownerHeaders })).data.data;
  const pay3Res = await request(`/group-bookings/${gb.id}/contribute`, {
    method: 'POST',
    headers: member2Headers,
    body: { amount: 3000, lastKnownUpdatedAt: postPay2GB.updatedAt }
  });
  assert(pay3Res.status === 200, 'Member 2 payment failed');

  const postPay3GB = (await request(`/group-bookings/${gb.id}`, { headers: ownerHeaders })).data.data;
  const pay4Res = await request(`/group-bookings/${gb.id}/contribute`, {
    method: 'POST',
    headers: ownerHeaders,
    body: { amount: 2000, lastKnownUpdatedAt: postPay3GB.updatedAt }
  });
  assert(pay4Res.status === 200, 'Owner payment failed');
  console.log('✓ Contributions verified');

  // Verify completion status
  const finalGB = (await request(`/group-bookings/${gb.id}`, { headers: ownerHeaders })).data.data;
  assert(finalGB.status === 'completed', 'Group booking should be completed');

  const finalOrder = await db.select().from(bookingOrders).where(eq(bookingOrders.id, bookingOrderId));
  assert(finalOrder[0].status === 'confirmed', 'Booking order should be confirmed');
  console.log('✓ Group booking fully completed and order confirmed');

  // INVENTORY CONVERSION VERIFIED: Conversion from reserved to sold
  await inventory.reconcileCachedInventory(db, { tenantId: tenant.id, ticketTypeIds: [ticketType.id], repair: true });
  const ttFinal = await db.select().from(ticketTypes).where(eq(ticketTypes.id, ticketType.id));
  assert(ttFinal[0].reservedQuantity === 0, `Reserved quantity should convert to 0, got ${ttFinal[0].reservedQuantity}`);
  assert(ttFinal[0].soldQuantity === 4, `Sold quantity should become 4, got ${ttFinal[0].soldQuantity}`);
  console.log('✓ Inventory conversion verified (reservedQuantity = 0, soldQuantity = 4)');

  // 15. TICKET ISSUANCE VERIFICATION
  const tickets = await db.select().from(issuedTickets).where(eq(issuedTickets.bookingOrderId, bookingOrderId));
  assert(tickets.length === 4, `Expected 4 issued tickets, got ${tickets.length}`);
  for (const t of tickets) {
    assert(!!t.ticketNumber, 'Ticket number missing on issued ticket');
    assert(!!t.qrCodeToken, 'QR code token missing on issued ticket');
  }
  console.log('✓ Tickets issued successfully (count = 4, with ticketNumbers and qrCodeTokens)');

  // 16. TICKET VALIDATION & CHECK-IN
  const ticket = tickets[0];
  const scanVal = await request('/issued-tickets/validate', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      ticketNumber: ticket.ticketNumber,
      scannerDeviceId: 'scanner-1',
      scannerGate: 'gate-a'
    }
  });
  assert(scanVal.status === 200, 'Ticket validation endpoint failed');
  assert(scanVal.data.data.status === 'valid', `Expected status to be valid, got ${scanVal.data.data.status}`);

  const checkInRes = await request(`/issued-tickets/${ticket.ticketNumber}/check-in`, {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      scannerDeviceId: 'scanner-1',
      scannerGate: 'gate-a',
      lastKnownUpdatedAt: scanVal.data.data.ticket.updatedAt,
    }
  });
  assert(checkInRes.status === 200, 'Ticket check-in failed');

  // Duplicate Check-In detection -> Should fail with 400 Bad Request
  const ticketAfterCheckIn = await db.select().from(issuedTickets).where(eq(issuedTickets.id, ticket.id));
  const dupCheckIn = await request(`/issued-tickets/${ticket.ticketNumber}/check-in`, {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      scannerDeviceId: 'scanner-1',
      scannerGate: 'gate-a',
      lastKnownUpdatedAt: ticketAfterCheckIn[0].updatedAt.toISOString()
    }
  });
  assert(dupCheckIn.status === 409, 'Duplicate check-in should fail with 409');
  console.log('✓ Ticket validation & duplicate check-in detection verified');

  // 17. ACTIVITY AUDIT VERIFICATION
  const activities = await db.select().from(groupBookingActivity).where(eq(groupBookingActivity.groupBookingId, gb.id)).orderBy(groupBookingActivity.createdAt);
  assert(activities.length > 0, 'Audit logs must not be empty');
  const actTypes = activities.map(a => a.type);
  assert(actTypes.includes('created'), 'Audit log missing "created" event');
  assert(actTypes.includes('member_invited'), 'Audit log missing "member_invited" event');
  assert(actTypes.includes('member_joined'), 'Audit log missing "member_joined" event');
  assert(actTypes.includes('member_declined'), 'Audit log missing "member_declined" event');
  assert(actTypes.includes('share_updated'), 'Audit log missing "share_updated" event');
  assert(actTypes.includes('contribution_recorded'), 'Audit log missing "contribution_recorded" event');
  assert(actTypes.includes('booking_completed'), 'Audit log missing "booking_completed" event');
  console.log('✓ Activity logs verified');

  // 18. NOTIFICATIONS VERIFICATION
  const userNotifications = await db.select().from(notifications).where(eq(notifications.tenantId, tenant.id));
  assert(userNotifications.length > 0, 'Notifications records should exist in notifications table');
  const notifTypes = userNotifications.map(n => n.type);
  assert(notifTypes.includes('invited_to_group'), 'Notification invited_to_group missing');
  assert(notifTypes.includes('invite_accepted'), 'Notification invite_accepted missing');
  assert(notifTypes.includes('group_booking_completed'), 'Notification group_booking_completed missing');
  console.log('✓ Notifications verified');

  // 19. TENANT ISOLATION BOUNDS
  // Stranger cannot view booking
  const badView = await request(`/group-bookings/${gb.id}`, { headers: strangerHeaders });
  assert(badView.status === 403, `Outsider view booking should return 403, got ${badView.status}`);

  // Stranger cannot contribute
  const badContribute = await request(`/group-bookings/${gb.id}/contribute`, {
    method: 'POST',
    headers: strangerHeaders,
    body: { amount: 1000, lastKnownUpdatedAt: finalGB.updatedAt }
  });
  assert(badContribute.status === 403, `Outsider contribute should return 403, got ${badContribute.status}`);

  // Stranger cannot accept invitation
  const badAccept = await request(`/group-bookings/${gb.id}/accept`, {
    method: 'POST',
    headers: strangerHeaders
  });
  assert(badAccept.status === 403, `Outsider accept invite should return 403, got ${badAccept.status}`);

  // Stranger cannot decline invitation
  const badDecline = await request(`/group-bookings/${gb.id}/decline`, {
    method: 'POST',
    headers: strangerHeaders
  });
  assert(badDecline.status === 403, `Outsider decline invite should return 403, got ${badDecline.status}`);
  console.log('✓ Tenant isolation verified');


  console.log('\nRUNNING SCENARIO 2: EXPLICIT CANCELLATION FLOW...');

  // Create cancel group booking
  const cancelGBRes = await request('/group-bookings', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      eventId: event.id,
      ticketSelections: [{ ticketTypeId: ticketType.id, quantity: 2 }],
      title: 'Cancellation Gang'
    }
  });
  assert(cancelGBRes.status === 201, 'Cancel test booking creation failed');
  const cgb = cancelGBRes.data.data;

  // Assert inventory reserved
  await inventory.reconcileCachedInventory(db, { tenantId: tenant.id, ticketTypeIds: [ticketType.id], repair: true });
  let ttCancelBefore = await db.select().from(ticketTypes).where(eq(ticketTypes.id, ticketType.id));
  assert(ttCancelBefore[0].reservedQuantity === 2, `Reserved quantity should be 2 for cancellation test, got ${ttCancelBefore[0].reservedQuantity}`);

  // Cancel booking
  const cancelRes = await request(`/group-bookings/${cgb.id}/cancel`, {
    method: 'POST',
    headers: ownerHeaders,
    body: { lastKnownUpdatedAt: cgb.updatedAt }
  });
  assert(cancelRes.status === 200, 'Booking cancellation failed');

  // Verify group booking status
  const cgbAfter = (await request(`/group-bookings/${cgb.id}`, { headers: ownerHeaders })).data.data;
  assert(cgbAfter.status === 'cancelled', 'Group booking should be cancelled');

  // Verify order status
  const cgbOrder = await db.select().from(bookingOrders).where(eq(bookingOrders.id, cgb.bookingOrderId));
  assert(cgbOrder[0].status === 'cancelled', 'Booking order should be cancelled');

  // Verify inventory released (reservedQuantity becomes 0)
  await inventory.reconcileCachedInventory(db, { tenantId: tenant.id, ticketTypeIds: [ticketType.id], repair: true });
  let ttCancelAfter = await db.select().from(ticketTypes).where(eq(ticketTypes.id, ticketType.id));
  assert(ttCancelAfter[0].reservedQuantity === 0, `Reserved quantity should release to 0 after cancel, got ${ttCancelAfter[0].reservedQuantity}`);

  // Verify tickets not issued
  const cancelTickets = await db.select().from(issuedTickets).where(eq(issuedTickets.bookingOrderId, cgb.bookingOrderId));
  assert(cancelTickets.length === 0, 'No tickets should be issued for cancelled bookings');

  // Verify cancelled activity logged
  const cancelActs = await db.select().from(groupBookingActivity).where(eq(groupBookingActivity.groupBookingId, cgb.id));
  const cancelActTypes = cancelActs.map(a => a.type);
  assert(cancelActTypes.includes('booking_cancelled'), 'Missing booking_cancelled activity event');
  console.log('✓ Cancellation verified');


  console.log('\nRUNNING SCENARIO 3: EXPLICIT EXPIRATION FLOW...');

  // Create expiration group booking
  const expireGBRes = await request('/group-bookings', {
    method: 'POST',
    headers: ownerHeaders,
    body: {
      eventId: event.id,
      ticketSelections: [{ ticketTypeId: ticketType.id, quantity: 1 }],
      title: 'Expiration Gang'
    }
  });
  assert(expireGBRes.status === 201, 'Expire test booking creation failed');
  const egb = expireGBRes.data.data;

  // Assert inventory reserved
  await inventory.reconcileCachedInventory(db, { tenantId: tenant.id, ticketTypeIds: [ticketType.id], repair: true });
  let ttExpireBefore = await db.select().from(ticketTypes).where(eq(ticketTypes.id, ticketType.id));
  assert(ttExpireBefore[0].reservedQuantity === 1, `Reserved quantity should be 1 for expiration test, got ${ttExpireBefore[0].reservedQuantity}`);

  // Directly update expiresAt in database to be in the past
  await db
    .update(groupBookings)
    .set({ expiresAt: new Date(Date.now() - 5 * 60 * 1000) })
    .where(eq(groupBookings.id, egb.id));

  // Retrieve booking to trigger on-the-fly expiration check
  const getEgbRes = await request(`/group-bookings/${egb.id}`, { headers: ownerHeaders });
  assert(getEgbRes.status === 200, 'Retrieve expired booking failed');
  assert(getEgbRes.data.data.status === 'expired', 'Group booking should be marked expired');

  // Verify order status
  const egbOrder = await db.select().from(bookingOrders).where(eq(bookingOrders.id, egb.bookingOrderId));
  assert(egbOrder[0].status === 'expired', 'Booking order should be expired');

  // Verify inventory released (reservedQuantity becomes 0)
  await inventory.reconcileCachedInventory(db, { tenantId: tenant.id, ticketTypeIds: [ticketType.id], repair: true });
  let ttExpireAfter = await db.select().from(ticketTypes).where(eq(ticketTypes.id, ticketType.id));
  assert(ttExpireAfter[0].reservedQuantity === 0, `Reserved quantity should release to 0 after expiration, got ${ttExpireAfter[0].reservedQuantity}`);

  // Verify tickets not issued
  const expireTickets = await db.select().from(issuedTickets).where(eq(issuedTickets.bookingOrderId, egb.bookingOrderId));
  assert(expireTickets.length === 0, 'No tickets should be issued for expired bookings');

  // Verify expired activity logged
  const expireActs = await db.select().from(groupBookingActivity).where(eq(groupBookingActivity.groupBookingId, egb.id));
  const expireActTypes = expireActs.map(a => a.type);
  assert(expireActTypes.includes('booking_expired'), 'Missing booking_expired activity event');
  console.log('✓ Expiration verified');

  console.log('\nGROUP BOOKINGS SMOKE TEST PASSED\n');
}

run().catch((err) => {
  console.error('GROUP BOOKINGS SMOKE TEST FAILED');
  console.error(err);
  process.exit(1);
});
