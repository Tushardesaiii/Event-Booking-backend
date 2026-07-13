import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  attendees,
  bookingOrderItemAttendees,
  bookingOrderItems,
  bookingOrders,
  events,
  inventoryReservations,
  issuedTicketEvents,
  issuedTickets,
  ticketTypes,
  groupBookings,
  groupBookingMembers
} from '../../db/schema/index.js';

export async function findEventByTenantAndSlug(tenantId: string, slug: string) {
  const [event] = await db
    .select({
      id: events.id,
      title: events.title,
      tenantId: events.tenantId,
      startDateTime: events.startDateTime
    })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.slug, slug), isNull(events.deletedAt)))
    .limit(1);

  return event ?? null;
}

export async function getDashboardRawMetrics(tenantId: string, eventId: string) {
  // 1. Capacity
  const [capacityResult] = await db
    .select({
      total: sql<number>`cast(coalesce(sum(${ticketTypes.totalQuantity}), 0) as integer)`
    })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.eventId, eventId), eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)));

  const totalCapacity = capacityResult?.total ?? 0;

  // 2. Sold tickets
  const [soldResult] = await db
    .select({
      sold: sql<number>`cast(coalesce(sum(${bookingOrderItems.quantity}), 0) as integer)`
    })
    .from(bookingOrderItems)
    .innerJoin(
      bookingOrders,
      and(
        eq(bookingOrders.id, bookingOrderItems.bookingOrderId),
        eq(bookingOrders.eventId, eventId),
        eq(bookingOrders.tenantId, tenantId),
        isNull(bookingOrders.deletedAt),
        inArray(bookingOrders.status, ['confirmed', 'paid', 'completed'])
      )
    );

  const ticketsSold = soldResult?.sold ?? 0;

  // 3. Reserved tickets
  const [reservedResult] = await db
    .select({
      reserved: sql<number>`cast(coalesce(sum(${inventoryReservations.quantity}), 0) as integer)`
    })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.eventId, eventId),
        eq(inventoryReservations.tenantId, tenantId),
        eq(inventoryReservations.status, 'active'),
        isNull(inventoryReservations.deletedAt),
        isNull(inventoryReservations.convertedAt),
        isNull(inventoryReservations.releasedAt),
        gt(inventoryReservations.expiresAt, new Date())
      )
    );

  const ticketsReserved = reservedResult?.reserved ?? 0;
  const ticketsAvailable = Math.max(0, totalCapacity - ticketsSold - ticketsReserved);

  // 4. Bookings count grouped by status
  const bookingCounts = await db
    .select({
      status: bookingOrders.status,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(bookingOrders)
    .where(and(eq(bookingOrders.eventId, eventId), eq(bookingOrders.tenantId, tenantId), isNull(bookingOrders.deletedAt)))
    .groupBy(bookingOrders.status);

  // 5. Registered Attendees
  const [attendeeResult] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(attendees)
    .where(and(eq(attendees.eventId, eventId), eq(attendees.tenantId, tenantId), isNull(attendees.deletedAt)));

  const attendeesRegistered = attendeeResult?.count ?? 0;

  // 6. Issued tickets count grouped by status
  const checkinCounts = await db
    .select({
      status: issuedTickets.status,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTickets)
    .where(and(eq(issuedTickets.eventId, eventId), eq(issuedTickets.tenantId, tenantId), isNull(issuedTickets.deletedAt)))
    .groupBy(issuedTickets.status);

  // 7. Revenue grouped by status
  const revenueResult = await db
    .select({
      status: bookingOrders.status,
      revenue: sql<string>`coalesce(sum(${bookingOrders.totalAmount}), '0')`
    })
    .from(bookingOrders)
    .where(and(eq(bookingOrders.eventId, eventId), eq(bookingOrders.tenantId, tenantId), isNull(bookingOrders.deletedAt)))
    .groupBy(bookingOrders.status);

  // 8. Failures today
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [failuresResult] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTicketEvents)
    .leftJoin(issuedTickets, eq(issuedTickets.id, issuedTicketEvents.issuedTicketId))
    .where(
      and(
        eq(issuedTicketEvents.tenantId, tenantId),
        ne(issuedTicketEvents.outcome, 'valid'),
        gte(issuedTicketEvents.createdAt, startOfToday),
        or(
          eq(issuedTickets.eventId, eventId),
          isNull(issuedTicketEvents.issuedTicketId)
        )
      )
    );

  const validationFailuresToday = failuresResult?.count ?? 0;

  // 9. Group Bookings Metrics
  const [groupBookingsCountResult] = await db
    .select({
      total: sql<number>`cast(count(*) as integer)`,
      completed: sql<number>`cast(count(case when ${groupBookings.status} = 'completed' then 1 end) as integer)`,
      totalRevenue: sql<string>`coalesce(sum(${groupBookings.collectedAmount}), '0')`
    })
    .from(groupBookings)
    .where(and(eq(groupBookings.eventId, eventId), eq(groupBookings.tenantId, tenantId), isNull(groupBookings.deletedAt)));

  const groupBookingsCreated = groupBookingsCountResult?.total ?? 0;
  const groupBookingsCompleted = groupBookingsCountResult?.completed ?? 0;
  const groupBookingsRevenue = parseFloat(groupBookingsCountResult?.totalRevenue ?? '0');

  const [avgSizeResult] = await db
    .select({
      avgSize: sql<number>`cast(coalesce(avg(member_count), 0) as double precision)`
    })
    .from(
      db
        .select({
          member_count: sql<number>`cast(count(${groupBookingMembers.id}) as integer)`.as('member_count')
        })
        .from(groupBookings)
        .leftJoin(groupBookingMembers, and(
          eq(groupBookingMembers.groupBookingId, groupBookings.id),
          eq(groupBookingMembers.inviteStatus, 'accepted'),
          isNull(groupBookingMembers.deletedAt)
        ))
        .where(and(
          eq(groupBookings.eventId, eventId),
          eq(groupBookings.tenantId, tenantId),
          isNull(groupBookings.deletedAt)
        ))
        .groupBy(groupBookings.id)
        .as('group_sizes')
    );

  const groupBookingsAverageSize = avgSizeResult?.avgSize ?? 0;

  return {
    ticketsSold,
    ticketsAvailable,
    ticketsReserved,
    bookingCounts,
    attendeesRegistered,
    checkinCounts,
    revenueResult,
    validationFailuresToday,
    groupBookingsCreated,
    groupBookingsCompleted,
    groupBookingsAverageSize,
    groupBookingsRevenue
  };
}

export async function getSalesTimeseries(
  tenantId: string,
  eventId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(bookingOrders.tenantId, tenantId),
    eq(bookingOrders.eventId, eventId),
    isNull(bookingOrders.deletedAt),
    inArray(bookingOrders.status, ['confirmed', 'paid', 'completed'])
  ];

  if (startDate) {
    conditions.push(gte(bookingOrders.createdAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(bookingOrders.createdAt, new Date(endDate)));
  }

  const truncField = sql`date_trunc(${sql.raw(`'${interval}'`)}, ${bookingOrders.createdAt})`;

  const rows = await db
    .select({
      date: sql<string>`to_char(${truncField}, 'YYYY-MM-DD')`,
      count: sql<number>`cast(sum(${bookingOrderItems.quantity}) as integer)`
    })
    .from(bookingOrderItems)
    .innerJoin(bookingOrders, eq(bookingOrders.id, bookingOrderItems.bookingOrderId))
    .where(and(...conditions))
    .groupBy(truncField)
    .orderBy(truncField);

  return rows;
}

export async function getRevenueTimeseries(
  tenantId: string,
  eventId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(bookingOrders.tenantId, tenantId),
    eq(bookingOrders.eventId, eventId),
    isNull(bookingOrders.deletedAt),
    inArray(bookingOrders.status, ['confirmed', 'paid', 'completed'])
  ];

  if (startDate) {
    conditions.push(gte(bookingOrders.createdAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(bookingOrders.createdAt, new Date(endDate)));
  }

  const truncField = sql`date_trunc(${sql.raw(`'${interval}'`)}, ${bookingOrders.createdAt})`;

  const rows = await db
    .select({
      date: sql<string>`to_char(${truncField}, 'YYYY-MM-DD')`,
      revenue: sql<number>`cast(coalesce(sum(${bookingOrders.totalAmount}), 0) * 100 as integer)`
    })
    .from(bookingOrders)
    .where(and(...conditions))
    .groupBy(truncField)
    .orderBy(truncField);

  return rows;
}

export async function getTicketTypeBreakdown(tenantId: string, eventId: string) {
  const soldSub = db
    .select({
      ticketTypeId: bookingOrderItems.ticketTypeId,
      sold: sql<number>`cast(coalesce(sum(${bookingOrderItems.quantity}), 0) as integer)`.as('sold'),
      revenue: sql<string>`coalesce(sum(${bookingOrderItems.totalAmount}), '0')`.as('revenue')
    })
    .from(bookingOrderItems)
    .innerJoin(bookingOrders, eq(bookingOrders.id, bookingOrderItems.bookingOrderId))
    .where(
      and(
        eq(bookingOrders.eventId, eventId),
        eq(bookingOrders.tenantId, tenantId),
        isNull(bookingOrders.deletedAt),
        inArray(bookingOrders.status, ['confirmed', 'paid', 'completed'])
      )
    )
    .groupBy(bookingOrderItems.ticketTypeId)
    .as('sold_sub');

  const resSub = db
    .select({
      ticketTypeId: inventoryReservations.ticketTypeId,
      reserved: sql<number>`cast(coalesce(sum(${inventoryReservations.quantity}), 0) as integer)`.as('reserved')
    })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.eventId, eventId),
        eq(inventoryReservations.tenantId, tenantId),
        eq(inventoryReservations.status, 'active'),
        isNull(inventoryReservations.deletedAt),
        isNull(inventoryReservations.convertedAt),
        isNull(inventoryReservations.releasedAt),
        gt(inventoryReservations.expiresAt, new Date())
      )
    )
    .groupBy(inventoryReservations.ticketTypeId)
    .as('res_sub');

  const checkinSub = db
    .select({
      ticketTypeId: issuedTickets.ticketTypeId,
      checkedIn: sql<number>`cast(count(*) as integer)`.as('checked_in')
    })
    .from(issuedTickets)
    .where(
      and(
        eq(issuedTickets.eventId, eventId),
        eq(issuedTickets.tenantId, tenantId),
        eq(issuedTickets.status, 'checked_in'),
        isNull(issuedTickets.deletedAt)
      )
    )
    .groupBy(issuedTickets.ticketTypeId)
    .as('checkin_sub');

  return db
    .select({
      ticketTypeId: ticketTypes.id,
      name: ticketTypes.name,
      slug: ticketTypes.slug,
      totalQuantity: ticketTypes.totalQuantity,
      soldQuantity: sql<number>`coalesce(${soldSub.sold}, 0)`,
      reservedQuantity: sql<number>`coalesce(${resSub.reserved}, 0)`,
      checkInCount: sql<number>`coalesce(${checkinSub.checkedIn}, 0)`,
      revenueContribution: sql<string>`coalesce(${soldSub.revenue}, '0')`
    })
    .from(ticketTypes)
    .leftJoin(soldSub, eq(soldSub.ticketTypeId, ticketTypes.id))
    .leftJoin(resSub, eq(resSub.ticketTypeId, ticketTypes.id))
    .leftJoin(checkinSub, eq(checkinSub.ticketTypeId, ticketTypes.id))
    .where(and(eq(ticketTypes.eventId, eventId), eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)));
}

export async function getAttendeeAssignmentRate(tenantId: string, eventId: string) {
  const [assignmentResult] = await db
    .select({
      assigned: sql<number>`cast(count(*) as integer)`
    })
    .from(bookingOrderItemAttendees)
    .innerJoin(bookingOrders, eq(bookingOrders.id, bookingOrderItemAttendees.bookingOrderId))
    .where(
      and(
        eq(bookingOrders.eventId, eventId),
        eq(bookingOrders.tenantId, tenantId),
        isNull(bookingOrders.deletedAt),
        isNull(bookingOrderItemAttendees.deletedAt)
      )
    );

  return assignmentResult?.assigned ?? 0;
}

export async function getCheckinTimeseriesByHour(tenantId: string, eventId: string) {
  const truncField = sql`date_trunc('hour', ${issuedTickets.checkedInAt})`;

  return db
    .select({
      hour: sql<string>`to_char(${truncField}, 'YYYY-MM-DD HH24:00:00')`,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTickets)
    .where(
      and(
        eq(issuedTickets.eventId, eventId),
        eq(issuedTickets.tenantId, tenantId),
        eq(issuedTickets.status, 'checked_in'),
        isNull(issuedTickets.deletedAt)
      )
    )
    .groupBy(truncField)
    .orderBy(truncField);
}

export async function getCheckinTimeseriesByDay(tenantId: string, eventId: string) {
  const truncField = sql`date_trunc('day', ${issuedTickets.checkedInAt})`;

  return db
    .select({
      day: sql<string>`to_char(${truncField}, 'YYYY-MM-DD')`,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTickets)
    .where(
      and(
        eq(issuedTickets.eventId, eventId),
        eq(issuedTickets.tenantId, tenantId),
        eq(issuedTickets.status, 'checked_in'),
        isNull(issuedTickets.deletedAt)
      )
    )
    .groupBy(truncField)
    .orderBy(truncField);
}

export async function getReservationStats(tenantId: string, eventId: string) {
  const stats = await db
    .select({
      status: inventoryReservations.status,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.eventId, eventId),
        eq(inventoryReservations.tenantId, tenantId),
        isNull(inventoryReservations.deletedAt)
      )
    )
    .groupBy(inventoryReservations.status);

  return stats;
}

export async function getCheckinSummaryLogs(tenantId: string, eventId: string) {
  const logs = await db
    .select({
      outcome: issuedTicketEvents.outcome,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTicketEvents)
    .leftJoin(issuedTickets, eq(issuedTickets.id, issuedTicketEvents.issuedTicketId))
    .where(
      and(
        eq(issuedTicketEvents.tenantId, tenantId),
        or(
          eq(issuedTickets.eventId, eventId),
          isNull(issuedTicketEvents.issuedTicketId)
        ),
        inArray(issuedTicketEvents.outcome, [
          'valid',
          'already_checked_in',
          'cancelled',
          'invalidated',
          'refunded',
          'deleted',
          'tenant_mismatch',
          'stale_ticket',
          'invalid_qr',
          'unauthorized_scanner'
        ])
      )
    )
    .groupBy(issuedTicketEvents.outcome);

  return logs;
}

export async function getActiveScannerCount(tenantId: string, eventId: string, minutes: number = 30) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const [row] = await db
    .select({
      count: sql<number>`cast(count(distinct ${issuedTicketEvents.scannerOperatorUserId}) as integer)`
    })
    .from(issuedTicketEvents)
    .innerJoin(issuedTickets, eq(issuedTickets.id, issuedTicketEvents.issuedTicketId))
    .where(
      and(
        eq(issuedTicketEvents.tenantId, tenantId),
        eq(issuedTickets.eventId, eventId),
        gte(issuedTicketEvents.createdAt, cutoff)
      )
    );

  return row?.count ?? 0;
}

export async function getActivityFeed(
  tenantId: string,
  eventId: string,
  limit: number,
  cursor?: string,
  types?: string[]
) {
  const typeConditions: string[] = [];
  if (types && types.length > 0) {
    typeConditions.push(`activity_type IN (${types.map((t) => `'${t}'`).join(',')})`);
  }
  if (cursor) {
    // Format timestamp correctly for query
    typeConditions.push(`created_at < '${new Date(cursor).toISOString()}'`);
  }

  const whereClause = typeConditions.length > 0 ? `WHERE ${typeConditions.join(' AND ')}` : '';

  const rawQuery = sql`
    SELECT * FROM (
      SELECT 
        'booking_created' as activity_type,
        id::text as id,
        created_at,
        purchaser_user_id::text as actor_user_id,
        json_build_object('orderNumber', order_number, 'totalAmount', total_amount) as metadata
      FROM booking_orders
      WHERE event_id = ${eventId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'booking_confirmed' as activity_type,
        id::text as id,
        confirmed_at as created_at,
        updated_by_user_id::text as actor_user_id,
        json_build_object('orderNumber', order_number, 'totalAmount', total_amount) as metadata
      FROM booking_orders
      WHERE event_id = ${eventId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'confirmed' AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'ticket_checked_in' as activity_type,
        id::text as id,
        checked_in_at as created_at,
        checked_in_by_user_id::text as actor_user_id,
        json_build_object('ticketNumber', ticket_number, 'attendeeId', attendee_id) as metadata
      FROM issued_tickets
      WHERE event_id = ${eventId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'checked_in' AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'attendee_registered' as activity_type,
        id::text as id,
        created_at,
        created_by_user_id::text as actor_user_id,
        json_build_object('fullName', full_name, 'ticketTypeId', ticket_type_id) as metadata
      FROM attendees
      WHERE event_id = ${eventId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'ticket_validation_rejected' as activity_type,
        ite.id::text as id,
        ite.created_at,
        ite.actor_user_id::text as actor_user_id,
        json_build_object('outcome', ite.outcome, 'scannerDeviceId', ite.scanner_device_id) as metadata
      FROM issued_ticket_events ite
      LEFT JOIN issued_tickets it ON it.id = ite.issued_ticket_id
      WHERE ite.tenant_id = ${tenantId}::uuid 
        AND ite.outcome != 'valid' 
        AND (it.event_id = ${eventId}::uuid OR ite.issued_ticket_id IS NULL)
    ) q
    ${sql.raw(whereClause)}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const rows = await db.execute(rawQuery);
  return rows as unknown as Array<{
    activity_type: string;
    id: string;
    created_at: string;
    actor_user_id: string | null;
    metadata: string | Record<string, unknown>;
  }>;
}
