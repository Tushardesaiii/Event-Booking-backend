import { and, asc, desc, eq, gt, gte, inArray, isNull, isNotNull, lt, lte, ne, or, sql } from 'drizzle-orm';

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
  marketingCampaignDeliveries,
  marketingCampaigns,
  marketingSubscribers,
  tenants,
  ticketTypes,
  groupBookings,
  groupBookingMembers
} from '../../db/schema/index.js';

export async function findTenantBySlug(slug: string) {
  const [tenant] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug
    })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
    .limit(1);

  return tenant ?? null;
}

export async function getDashboardRawMetrics(tenantId: string) {
  // 1. Capacity
  const [capacityResult] = await db
    .select({
      total: sql<number>`cast(coalesce(sum(${ticketTypes.totalQuantity}), 0) as integer)`
    })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)));

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
      count: sql<number>`cast(count(*) as integer)`,
      revenue: sql<string>`coalesce(sum(${bookingOrders.totalAmount}), '0')`
    })
    .from(bookingOrders)
    .where(and(eq(bookingOrders.tenantId, tenantId), isNull(bookingOrders.deletedAt)))
    .groupBy(bookingOrders.status);

  // 5. Registered Attendees
  const [attendeeResult] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(attendees)
    .where(and(eq(attendees.tenantId, tenantId), isNull(attendees.deletedAt)));

  const attendeesRegistered = attendeeResult?.count ?? 0;

  // 6. Checked-in Attendees
  const [checkedInResult] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTickets)
    .where(and(
      eq(issuedTickets.tenantId, tenantId),
      eq(issuedTickets.status, 'checked_in'),
      isNull(issuedTickets.deletedAt)
    ));

  const attendeesCheckedIn = checkedInResult?.count ?? 0;

  // 7. Event counts
  const [eventCounts] = await db
    .select({
      total: sql<number>`cast(count(*) as integer)`,
      published: sql<number>`cast(count(case when ${events.status} = 'published' then 1 end) as integer)`,
      upcoming: sql<number>`cast(count(case when ${events.startDateTime} > now() then 1 end) as integer)`,
      completed: sql<number>`cast(count(case when ${events.endDateTime} < now() then 1 end) as integer)`
    })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), isNull(events.deletedAt)));

  // 8. Failures & total scans (for validation failure ratio)
  const [failuresResult] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTicketEvents)
    .where(
      and(
        eq(issuedTicketEvents.tenantId, tenantId),
        ne(issuedTicketEvents.outcome, 'valid')
      )
    );

  const [totalScansResult] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTicketEvents)
    .where(eq(issuedTicketEvents.tenantId, tenantId));

  const validationFailures = failuresResult?.count ?? 0;
  const totalScanAttempts = totalScansResult?.count ?? 0;

  // 9. Group Bookings Metrics
  const [groupBookingsCountResult] = await db
    .select({
      total: sql<number>`cast(count(*) as integer)`,
      completed: sql<number>`cast(count(case when ${groupBookings.status} = 'completed' then 1 end) as integer)`,
      totalRevenue: sql<string>`coalesce(sum(${groupBookings.collectedAmount}), '0')`
    })
    .from(groupBookings)
    .where(and(eq(groupBookings.tenantId, tenantId), isNull(groupBookings.deletedAt)));

  const groupBookingsCreated = groupBookingsCountResult?.total ?? 0;
  const groupBookingsCompleted = groupBookingsCountResult?.completed ?? 0;
  const groupBookingsRevenue = parseFloat(groupBookingsCountResult?.totalRevenue ?? '0');

  // Per-group member counts as a subquery; the column must be explicitly
  // aliased (.as('member_count')) so the outer avg() can reference it.
  const groupSizes = db
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
      eq(groupBookings.tenantId, tenantId),
      isNull(groupBookings.deletedAt)
    ))
    .groupBy(groupBookings.id)
    .as('group_sizes');

  const [avgSizeResult] = await db
    .select({
      avgSize: sql<number>`cast(coalesce(avg(${groupSizes.member_count}), 0) as double precision)`
    })
    .from(groupSizes);

  const groupBookingsAverageSize = avgSizeResult?.avgSize ?? 0;

  return {
    ticketsSold,
    ticketsAvailable,
    ticketsReserved,
    bookingCounts,
    attendeesRegistered,
    attendeesCheckedIn,
    eventCounts: eventCounts ?? { total: 0, published: 0, upcoming: 0, completed: 0 },
    validationFailures,
    totalScanAttempts,
    groupBookingsCreated,
    groupBookingsCompleted,
    groupBookingsAverageSize,
    groupBookingsRevenue
  };
}

export async function getConfirmedBookingCountInDateRange(tenantId: string, start: Date, end: Date) {
  const [result] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(bookingOrders)
    .where(and(
      eq(bookingOrders.tenantId, tenantId),
      inArray(bookingOrders.status, ['confirmed', 'paid', 'completed']),
      gte(bookingOrders.createdAt, start),
      lte(bookingOrders.createdAt, end),
      isNull(bookingOrders.deletedAt)
    ));

  return result?.count ?? 0;
}

export async function getSalesTimeseries(
  tenantId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(bookingOrders.tenantId, tenantId),
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
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(bookingOrders.tenantId, tenantId),
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

export async function getBookingTimeseries(
  tenantId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(bookingOrders.tenantId, tenantId),
    isNull(bookingOrders.deletedAt)
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
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(bookingOrders)
    .where(and(...conditions))
    .groupBy(truncField)
    .orderBy(truncField);

  return rows;
}

export async function getCancellationTimeseries(
  tenantId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(bookingOrders.tenantId, tenantId),
    eq(bookingOrders.status, 'cancelled'),
    isNull(bookingOrders.deletedAt)
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
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(bookingOrders)
    .where(and(...conditions))
    .groupBy(truncField)
    .orderBy(truncField);

  return rows;
}

export async function getAttendeeGrowthTimeseries(
  tenantId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(attendees.tenantId, tenantId),
    isNull(attendees.deletedAt)
  ];

  if (startDate) {
    conditions.push(gte(attendees.createdAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(attendees.createdAt, new Date(endDate)));
  }

  const truncField = sql`date_trunc(${sql.raw(`'${interval}'`)}, ${attendees.createdAt})`;

  const rows = await db
    .select({
      date: sql<string>`to_char(${truncField}, 'YYYY-MM-DD')`,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(attendees)
    .where(and(...conditions))
    .groupBy(truncField)
    .orderBy(truncField);

  return rows;
}

export async function getCheckinTimeseries(
  tenantId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(issuedTickets.tenantId, tenantId),
    eq(issuedTickets.status, 'checked_in'),
    isNull(issuedTickets.deletedAt)
  ];

  if (startDate) {
    conditions.push(gte(issuedTickets.checkedInAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(issuedTickets.checkedInAt, new Date(endDate)));
  }

  const truncField = sql`date_trunc(${sql.raw(`'${interval}'`)}, ${issuedTickets.checkedInAt})`;

  const rows = await db
    .select({
      date: sql<string>`to_char(${truncField}, 'YYYY-MM-DD')`,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(issuedTickets)
    .where(and(...conditions))
    .groupBy(truncField)
    .orderBy(truncField);

  return rows;
}

export async function getSubscriberGrowthTimeseries(
  tenantId: string,
  interval: 'day' | 'week' | 'month',
  startDate?: string,
  endDate?: string
) {
  const conditions = [
    eq(marketingSubscribers.tenantId, tenantId),
    isNull(marketingSubscribers.deletedAt)
  ];

  if (startDate) {
    conditions.push(gte(marketingSubscribers.subscribedAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(marketingSubscribers.subscribedAt, new Date(endDate)));
  }

  const truncField = sql`date_trunc(${sql.raw(`'${interval}'`)}, ${marketingSubscribers.subscribedAt})`;

  const rows = await db
    .select({
      date: sql<string>`to_char(${truncField}, 'YYYY-MM-DD')`,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(marketingSubscribers)
    .where(and(...conditions))
    .groupBy(truncField)
    .orderBy(truncField);

  return rows;
}

export async function getReservationStats(tenantId: string) {
  const stats = await db
    .select({
      status: inventoryReservations.status,
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.tenantId, tenantId),
        isNull(inventoryReservations.deletedAt)
      )
    )
    .groupBy(inventoryReservations.status);

  return stats;
}

export async function getAttendeeAssignmentRate(tenantId: string) {
  const [assignmentResult] = await db
    .select({
      assigned: sql<number>`cast(count(*) as integer)`
    })
    .from(bookingOrderItemAttendees)
    .innerJoin(bookingOrders, eq(bookingOrders.id, bookingOrderItemAttendees.bookingOrderId))
    .where(
      and(
        eq(bookingOrders.tenantId, tenantId),
        isNull(bookingOrders.deletedAt),
        isNull(bookingOrderItemAttendees.deletedAt)
      )
    );

  return assignmentResult?.assigned ?? 0;
}

export async function getMarketingCampaignStats(tenantId: string) {
  const [marketingSummary] = await db
    .select({
      totalCampaigns: sql<number>`cast(count(distinct ${marketingCampaigns.id}) as integer)`,
      sends: sql<number>`cast(count(${marketingCampaignDeliveries.id}) as integer)`,
      opens: sql<number>`cast(count(${marketingCampaignDeliveries.openedAt}) as integer)`,
      clicks: sql<number>`cast(count(${marketingCampaignDeliveries.clickedAt}) as integer)`,
      unsubscribes: sql<number>`cast(count(case when ${marketingCampaignDeliveries.deliveryStatus} = 'unsubscribed' then 1 end) as integer)`
    })
    .from(marketingCampaigns)
    .leftJoin(marketingCampaignDeliveries, eq(marketingCampaignDeliveries.campaignId, marketingCampaigns.id))
    .where(eq(marketingCampaigns.tenantId, tenantId));

  const [marketingSubscribersUnsubscribe] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`
    })
    .from(marketingSubscribers)
    .where(and(
      eq(marketingSubscribers.tenantId, tenantId),
      isNotNull(marketingSubscribers.unsubscribedAt),
      isNull(marketingSubscribers.deletedAt)
    ));

  return {
    totalCampaigns: marketingSummary?.totalCampaigns ?? 0,
    sends: marketingSummary?.sends ?? 0,
    opens: marketingSummary?.opens ?? 0,
    clicks: marketingSummary?.clicks ?? 0,
    unsubscribes: (marketingSummary?.unsubscribes ?? 0) + (marketingSubscribersUnsubscribe?.count ?? 0)
  };
}

export async function getTopEvents(
  tenantId: string,
  sortBy: 'ticketsSold' | 'revenue' | 'attendees' | 'checkIns',
  sortOrder: 'asc' | 'desc',
  limit: number
) {
  const soldSub = db
    .select({
      eventId: bookingOrders.eventId,
      ticketsSold: sql<number>`cast(coalesce(sum(${bookingOrderItems.quantity}), 0) as integer)`.as('tickets_sold'),
      revenue: sql<number>`cast(coalesce(sum(${bookingOrders.totalAmount}), 0) * 100 as integer)`.as('revenue')
    })
    .from(bookingOrderItems)
    .innerJoin(bookingOrders, eq(bookingOrders.id, bookingOrderItems.bookingOrderId))
    .where(and(
      eq(bookingOrders.tenantId, tenantId),
      isNull(bookingOrders.deletedAt),
      inArray(bookingOrders.status, ['confirmed', 'paid', 'completed'])
    ))
    .groupBy(bookingOrders.eventId)
    .as('sold_sub');

  const attendeeSub = db
    .select({
      eventId: attendees.eventId,
      attendeesCount: sql<number>`cast(count(*) as integer)`.as('attendees_count')
    })
    .from(attendees)
    .where(and(eq(attendees.tenantId, tenantId), isNull(attendees.deletedAt)))
    .groupBy(attendees.eventId)
    .as('attendee_sub');

  const checkinSub = db
    .select({
      eventId: issuedTickets.eventId,
      checkInsCount: sql<number>`cast(count(*) as integer)`.as('checkins_count')
    })
    .from(issuedTickets)
    .where(and(
      eq(issuedTickets.tenantId, tenantId),
      eq(issuedTickets.status, 'checked_in'),
      isNull(issuedTickets.deletedAt)
    ))
    .groupBy(issuedTickets.eventId)
    .as('checkin_sub');

  const query = db
    .select({
      eventName: events.title,
      ticketsSold: sql<number>`coalesce(${soldSub.ticketsSold}, 0)`,
      revenue: sql<number>`coalesce(${soldSub.revenue}, 0)`,
      attendees: sql<number>`coalesce(${attendeeSub.attendeesCount}, 0)`,
      checkIns: sql<number>`coalesce(${checkinSub.checkInsCount}, 0)`
    })
    .from(events)
    .leftJoin(soldSub, eq(soldSub.eventId, events.id))
    .leftJoin(attendeeSub, eq(attendeeSub.eventId, events.id))
    .leftJoin(checkinSub, eq(checkinSub.eventId, events.id))
    .where(and(eq(events.tenantId, tenantId), isNull(events.deletedAt)));

  if (sortBy === 'ticketsSold') {
    query.orderBy(sortOrder === 'asc' ? asc(sql`coalesce(${soldSub.ticketsSold}, 0)`) : desc(sql`coalesce(${soldSub.ticketsSold}, 0)`));
  } else if (sortBy === 'revenue') {
    query.orderBy(sortOrder === 'asc' ? asc(sql`coalesce(${soldSub.revenue}, 0)`) : desc(sql`coalesce(${soldSub.revenue}, 0)`));
  } else if (sortBy === 'attendees') {
    query.orderBy(sortOrder === 'asc' ? asc(sql`coalesce(${attendeeSub.attendeesCount}, 0)`) : desc(sql`coalesce(${attendeeSub.attendeesCount}, 0)`));
  } else if (sortBy === 'checkIns') {
    query.orderBy(sortOrder === 'asc' ? asc(sql`coalesce(${checkinSub.checkInsCount}, 0)`) : desc(sql`coalesce(${checkinSub.checkInsCount}, 0)`));
  }

  query.limit(limit);

  return query;
}

export async function getUpcomingEvents(tenantId: string) {
  const capacitySub = db
    .select({
      eventId: ticketTypes.eventId,
      capacity: sql<number>`cast(coalesce(sum(${ticketTypes.totalQuantity}), 0) as integer)`.as('capacity')
    })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)))
    .groupBy(ticketTypes.eventId)
    .as('capacity_sub');

  const soldSub = db
    .select({
      eventId: bookingOrders.eventId,
      sold: sql<number>`cast(coalesce(sum(${bookingOrderItems.quantity}), 0) as integer)`.as('sold')
    })
    .from(bookingOrderItems)
    .innerJoin(bookingOrders, eq(bookingOrders.id, bookingOrderItems.bookingOrderId))
    .where(and(
      eq(bookingOrders.tenantId, tenantId),
      isNull(bookingOrders.deletedAt),
      inArray(bookingOrders.status, ['confirmed', 'paid', 'completed'])
    ))
    .groupBy(bookingOrders.eventId)
    .as('sold_sub');

  const rows = await db
    .select({
      eventName: events.title,
      startDate: events.startDateTime,
      ticketsSold: sql<number>`coalesce(${soldSub.sold}, 0)`,
      totalCapacity: sql<number>`coalesce(${capacitySub.capacity}, 0)`
    })
    .from(events)
    .leftJoin(capacitySub, eq(capacitySub.eventId, events.id))
    .leftJoin(soldSub, eq(soldSub.eventId, events.id))
    .where(and(
      eq(events.tenantId, tenantId),
      gt(events.startDateTime, new Date()),
      isNull(events.deletedAt)
    ))
    .orderBy(asc(events.startDateTime));

  return rows;
}

export async function getTenantActivityFeed(
  tenantId: string,
  limit: number,
  cursor?: string,
  types?: string[],
  startDate?: string,
  endDate?: string
) {
  const outerConditions: string[] = [];
  if (types && types.length > 0) {
    outerConditions.push(`activity_type IN (${types.map((t) => `'${t}'`).join(',')})`);
  }
  if (cursor) {
    outerConditions.push(`created_at < '${new Date(cursor).toISOString()}'`);
  }
  if (startDate) {
    outerConditions.push(`created_at >= '${new Date(startDate).toISOString()}'`);
  }
  if (endDate) {
    outerConditions.push(`created_at <= '${new Date(endDate).toISOString()}'`);
  }

  const whereClause = outerConditions.length > 0 ? `WHERE ${outerConditions.join(' AND ')}` : '';

  const rawQuery = sql`
    SELECT * FROM (
      SELECT 
        'event_published' as activity_type,
        id::text as id,
        published_at as created_at,
        created_by_user_id::text as actor_user_id,
        json_build_object('eventTitle', title, 'slug', slug) as metadata
      FROM events
      WHERE tenant_id = ${tenantId}::uuid AND status = 'published' AND published_at IS NOT NULL AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'booking_confirmed' as activity_type,
        id::text as id,
        confirmed_at as created_at,
        updated_by_user_id::text as actor_user_id,
        json_build_object('orderNumber', order_number, 'totalAmount', total_amount) as metadata
      FROM booking_orders
      WHERE tenant_id = ${tenantId}::uuid AND status = 'confirmed' AND confirmed_at IS NOT NULL AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'ticket_issued' as activity_type,
        id::text as id,
        created_at,
        NULL as actor_user_id,
        json_build_object('ticketNumber', ticket_number, 'status', status) as metadata
      FROM issued_tickets
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'ticket_checked_in' as activity_type,
        id::text as id,
        checked_in_at as created_at,
        checked_in_by_user_id::text as actor_user_id,
        json_build_object('ticketNumber', ticket_number, 'attendeeId', attendee_id) as metadata
      FROM issued_tickets
      WHERE tenant_id = ${tenantId}::uuid AND status = 'checked_in' AND checked_in_at IS NOT NULL AND deleted_at IS NULL

      UNION ALL

      SELECT 
        'campaign_sent' as activity_type,
        id::text as id,
        sent_at as created_at,
        created_by::text as actor_user_id,
        json_build_object('campaignName', name, 'subject', subject) as metadata
      FROM marketing_campaigns
      WHERE tenant_id = ${tenantId}::uuid AND status = 'completed' AND sent_at IS NOT NULL

      UNION ALL

      SELECT 
        'subscriber_added' as activity_type,
        id::text as id,
        subscribed_at as created_at,
        NULL as actor_user_id,
        json_build_object('email', email, 'source', source) as metadata
      FROM marketing_subscribers
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
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
