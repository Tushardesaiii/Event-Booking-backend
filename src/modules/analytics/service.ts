import { notFound } from '../../lib/errors.js';
import * as repository from './repository.js';
import type {
  AdvancedAnalyticsResponse,
  DashboardSummaryResponse,
  LiveStatusResponse,
  ActivityFeedItem
} from './types.js';

export async function getDashboardSummary(tenantId: string, slug: string): Promise<DashboardSummaryResponse> {
  const event = await repository.findEventByTenantAndSlug(tenantId, slug);
  if (!event) {
    throw notFound('Event not found');
  }

  const raw = await repository.getDashboardRawMetrics(tenantId, event.id);

  // Map bookings
  let bookingsTotal = 0;
  let bookingsPending = 0;
  let bookingsConfirmed = 0;
  let bookingsCancelled = 0;

  for (const row of raw.bookingCounts) {
    bookingsTotal += row.count;
    if (row.status === 'pending') {
      bookingsPending += row.count;
    } else if (['confirmed', 'paid', 'completed'].includes(row.status)) {
      bookingsConfirmed += row.count;
    } else if (row.status === 'cancelled') {
      bookingsCancelled += row.count;
    }
  }

  // Map check-ins
  let ticketsCheckedIn = 0;
  let ticketsNotCheckedIn = 0;

  for (const row of raw.checkinCounts) {
    if (row.status === 'checked_in') {
      ticketsCheckedIn += row.count;
    } else if (['issued', 'transferred'].includes(row.status)) {
      ticketsNotCheckedIn += row.count;
    }
  }

  const totalActiveTickets = ticketsCheckedIn + ticketsNotCheckedIn;
  const checkInRate = totalActiveTickets > 0 ? Number(((ticketsCheckedIn / totalActiveTickets) * 100).toFixed(1)) : 0;

  // Map revenue
  let grossRevenueDecimal = 0;
  let estimatedRevenueDecimal = 0;

  for (const row of raw.revenueResult) {
    const val = parseFloat(row.revenue);
    if (['confirmed', 'paid', 'completed'].includes(row.status)) {
      grossRevenueDecimal += val;
      estimatedRevenueDecimal += val;
    } else if (row.status === 'pending') {
      estimatedRevenueDecimal += val;
    }
  }

  const grossRevenue = Math.round(grossRevenueDecimal * 100);
  const estimatedRevenue = Math.round(estimatedRevenueDecimal * 100);

  // Compute Health Score
  const totalCapacity = raw.ticketsSold + raw.ticketsAvailable + raw.ticketsReserved;
  const salesScore = totalCapacity > 0 ? (raw.ticketsSold / totalCapacity) * 100 : 100;

  // If event has not started yet, check-in contribution is equivalent to sales ratio
  const now = new Date();
  const eventStarted = event.startDateTime ? new Date(event.startDateTime) <= now : false;
  const checkinScore = eventStarted
    ? (totalActiveTickets > 0 ? (ticketsCheckedIn / totalActiveTickets) * 100 : 100)
    : salesScore;

  // Validation failures check
  // Compute checkin summary logs to find total attempts today
  let totalAttemptsToday = raw.validationFailuresToday + ticketsCheckedIn; // approximation of scan attempts today
  if (totalAttemptsToday === 0) totalAttemptsToday = 1;
  const failureRatio = raw.validationFailuresToday / totalAttemptsToday;
  const failureScore = Math.max(0, 100 - (failureRatio * 100 * 4));

  const healthScore = Math.round((salesScore * 0.40) + (checkinScore * 0.30) + (failureScore * 0.30));

  let healthStatus: 'Healthy' | 'Warning' | 'Critical' = 'Healthy';
  if (healthScore < 50) {
    healthStatus = 'Critical';
  } else if (healthScore < 80) {
    healthStatus = 'Warning';
  }

  return {
    eventId: event.id,
    eventName: event.title,
    ticketsSold: raw.ticketsSold,
    ticketsAvailable: raw.ticketsAvailable,
    ticketsReserved: raw.ticketsReserved,
    bookingsTotal,
    bookingsPending,
    bookingsConfirmed,
    bookingsCancelled,
    attendeesRegistered: raw.attendeesRegistered,
    ticketsCheckedIn,
    ticketsNotCheckedIn,
    checkInRate,
    grossRevenue,
    estimatedRevenue,
    healthScore,
    healthStatus,
    groupBookingsCreated: raw.groupBookingsCreated,
    groupBookingsCompleted: raw.groupBookingsCompleted,
    groupBookingsAverageSize: raw.groupBookingsAverageSize,
    groupBookingsRevenue: raw.groupBookingsRevenue,
    lastUpdatedAt: new Date().toISOString()
  };
}

export async function getAdvancedAnalytics(
  tenantId: string,
  slug: string,
  startDate?: string,
  endDate?: string
): Promise<AdvancedAnalyticsResponse> {
  const event = await repository.findEventByTenantAndSlug(tenantId, slug);
  if (!event) {
    throw notFound('Event not found');
  }

  const salesDaily = await repository.getSalesTimeseries(tenantId, event.id, 'day', startDate, endDate);
  const salesWeekly = await repository.getSalesTimeseries(tenantId, event.id, 'week', startDate, endDate);
  const salesMonthly = await repository.getSalesTimeseries(tenantId, event.id, 'month', startDate, endDate);

  const revenueDaily = await repository.getRevenueTimeseries(tenantId, event.id, 'day', startDate, endDate);
  const revenueWeekly = await repository.getRevenueTimeseries(tenantId, event.id, 'week', startDate, endDate);
  const revenueMonthly = await repository.getRevenueTimeseries(tenantId, event.id, 'month', startDate, endDate);

  const breakdownRaw = await repository.getTicketTypeBreakdown(tenantId, event.id);
  const ticketTypesBreakdown = breakdownRaw.map((row) => {
    const total = row.totalQuantity;
    const sold = row.soldQuantity;
    const reserved = row.reservedQuantity;
    const available = Math.max(0, total - sold - reserved);
    const utilization = total > 0 ? (sold / total) * 100 : 0;

    return {
      ticketTypeId: row.ticketTypeId,
      name: row.name,
      slug: row.slug,
      soldQuantity: sold,
      reservedQuantity: reserved,
      availableQuantity: available,
      checkInCount: row.checkInCount,
      revenueContribution: Math.round(parseFloat(row.revenueContribution) * 100),
      utilizationPercentage: Number(utilization.toFixed(1))
    };
  });

  // Booking stats
  const bookingStats = await repository.getDashboardRawMetrics(tenantId, event.id);
  let totalBookings = 0;
  let confirmedBookings = 0;
  let cancelledBookings = 0;
  let expiredBookings = 0;
  let refundedBookings = 0;
  let partiallyRefundedBookings = 0;

  for (const row of bookingStats.bookingCounts) {
    totalBookings += row.count;
    if (['confirmed', 'paid', 'completed'].includes(row.status)) {
      confirmedBookings += row.count;
    } else if (row.status === 'cancelled') {
      cancelledBookings += row.count;
    } else if (row.status === 'expired') {
      expiredBookings += row.count;
    } else if (row.status === 'refunded') {
      refundedBookings += row.count;
    } else if (row.status === 'partially_refunded') {
      partiallyRefundedBookings += row.count;
    }
  }

  // Attendee assignment
  const activeAssignments = await repository.getAttendeeAssignmentRate(tenantId, event.id);
  const totalSold = bookingStats.ticketsSold;
  const assignmentRate = totalSold > 0 ? Number(((activeAssignments / totalSold) * 100).toFixed(1)) : 0;

  // Checkins
  const checkinsByHour = await repository.getCheckinTimeseriesByHour(tenantId, event.id);
  const checkinsByDay = await repository.getCheckinTimeseriesByDay(tenantId, event.id);

  // Conversions
  const resStats = await repository.getReservationStats(tenantId, event.id);
  let totalReservations = 0;
  let convertedReservations = 0;
  for (const row of resStats) {
    totalReservations += row.count;
    if (row.status === 'converted') {
      convertedReservations += row.count;
    }
  }
  const reservationToBookingRate = totalReservations > 0 ? Number(((convertedReservations / totalReservations) * 100).toFixed(1)) : 0;

  const totalBookingsNonDraft = totalBookings; // count all booking states since draft is not normally checked out
  const bookingToConfirmedRate = totalBookingsNonDraft > 0 ? Number(((confirmedBookings / totalBookingsNonDraft) * 100).toFixed(1)) : 0;

  return {
    sales: {
      daily: salesDaily,
      weekly: salesWeekly,
      monthly: salesMonthly
    },
    revenue: {
      daily: revenueDaily,
      weekly: revenueWeekly,
      monthly: revenueMonthly
    },
    ticketTypes: ticketTypesBreakdown,
    bookings: {
      total: totalBookings,
      confirmed: confirmedBookings,
      cancelled: cancelledBookings,
      expired: expiredBookings,
      refunded: refundedBookings,
      partiallyRefunded: partiallyRefundedBookings
    },
    attendees: {
      registrations: bookingStats.attendeesRegistered,
      assignmentRate
    },
    checkins: {
      byHour: checkinsByHour,
      byDay: checkinsByDay
    },
    conversions: {
      reservationToBookingRate,
      bookingToConfirmedRate
    },
    lastUpdatedAt: new Date().toISOString()
  };
}

export async function getLiveStatus(tenantId: string, slug: string): Promise<LiveStatusResponse> {
  const event = await repository.findEventByTenantAndSlug(tenantId, slug);
  if (!event) {
    throw notFound('Event not found');
  }

  const raw = await repository.getDashboardRawMetrics(tenantId, event.id);

  let currentlyCheckedIn = 0;
  let remainingExpected = 0;

  for (const row of raw.checkinCounts) {
    if (row.status === 'checked_in') {
      currentlyCheckedIn += row.count;
    } else if (['issued', 'transferred'].includes(row.status)) {
      remainingExpected += row.count;
    }
  }

  const totalExpected = currentlyCheckedIn + remainingExpected;
  const rate = totalExpected > 0 ? (currentlyCheckedIn / totalExpected) * 100 : 0;
  const currentCheckInRate = `${rate.toFixed(1)}%`;

  const activeScanners = await repository.getActiveScannerCount(tenantId, event.id, 30);

  // Get lastScanAt
  const feed = await repository.getActivityFeed(tenantId, event.id, 1, undefined, ['ticket_checked_in']);
  const lastScanAt = feed.length > 0 ? feed[0].created_at : null;

  return {
    currentlyCheckedIn,
    remainingExpected,
    currentCheckInRate,
    activeScanners,
    lastScanAt,
    validationFailuresToday: raw.validationFailuresToday
  };
}

export async function getEventActivityFeed(
  tenantId: string,
  slug: string,
  limit: number,
  cursor?: string,
  typeFilter?: string
): Promise<ActivityFeedItem[]> {
  const event = await repository.findEventByTenantAndSlug(tenantId, slug);
  if (!event) {
    throw notFound('Event not found');
  }

  const filterTypes = typeFilter ? typeFilter.split(',').map((t) => t.trim()) : undefined;

  const raw = await repository.getActivityFeed(tenantId, event.id, limit, cursor, filterTypes);

  return raw.map((row) => ({
    id: row.id,
    activityType: row.activity_type,
    createdAt: new Date(row.created_at).toISOString(),
    actorUserId: row.actor_user_id,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
  }));
}

export async function getInventorySummary(tenantId: string, slug: string) {
  const event = await repository.findEventByTenantAndSlug(tenantId, slug);
  if (!event) {
    throw notFound('Event not found');
  }

  const breakdownRaw = await repository.getTicketTypeBreakdown(tenantId, event.id);
  return breakdownRaw.map((row) => {
    const total = row.totalQuantity;
    const sold = row.soldQuantity;
    const reserved = row.reservedQuantity;
    const available = Math.max(0, total - sold - reserved);
    const utilization = total > 0 ? (sold / total) * 100 : 0;

    return {
      ticketTypeId: row.ticketTypeId,
      ticketTypeName: row.name,
      totalInventory: total,
      soldInventory: sold,
      reservedInventory: reserved,
      availableInventory: available,
      utilizationPercentage: Number(utilization.toFixed(1))
    };
  });
}

export async function getAttendeeSummary(tenantId: string, slug: string) {
  const event = await repository.findEventByTenantAndSlug(tenantId, slug);
  if (!event) {
    throw notFound('Event not found');
  }

  const raw = await repository.getDashboardRawMetrics(tenantId, event.id);
  const activeAssignments = await repository.getAttendeeAssignmentRate(tenantId, event.id);

  let checkedInAttendees = 0;
  for (const row of raw.checkinCounts) {
    if (row.status === 'checked_in') {
      checkedInAttendees += row.count;
    }
  }

  const pendingAttendees = Math.max(0, raw.attendeesRegistered - checkedInAttendees);
  const attendeeCompletionPercentage = raw.attendeesRegistered > 0 ? Number(((activeAssignments / raw.attendeesRegistered) * 100).toFixed(1)) : 0;

  return {
    registeredAttendees: raw.attendeesRegistered,
    assignedAttendees: activeAssignments,
    checkedInAttendees,
    pendingAttendees,
    attendeeCompletionPercentage
  };
}

export async function getCheckinSummary(tenantId: string, slug: string) {
  const event = await repository.findEventByTenantAndSlug(tenantId, slug);
  if (!event) {
    throw notFound('Event not found');
  }

  const raw = await repository.getDashboardRawMetrics(tenantId, event.id);

  let checkedInCount = 0;
  let notCheckedInCount = 0;

  for (const row of raw.checkinCounts) {
    if (row.status === 'checked_in') {
      checkedInCount += row.count;
    } else if (['issued', 'transferred'].includes(row.status)) {
      notCheckedInCount += row.count;
    }
  }

  const logs = await repository.getCheckinSummaryLogs(tenantId, event.id);
  let duplicateScanAttempts = 0;
  let invalidScanAttempts = 0;
  let validScanAttempts = 0;
  let totalScanAttempts = 0;

  for (const row of logs) {
    totalScanAttempts += row.count;
    if (row.outcome === 'already_checked_in') {
      duplicateScanAttempts += row.count;
    } else if (row.outcome === 'valid') {
      validScanAttempts += row.count;
    } else {
      invalidScanAttempts += row.count;
    }
  }

  const validationSuccessRate = totalScanAttempts > 0 ? Number(((validScanAttempts / totalScanAttempts) * 100).toFixed(1)) : 0;

  return {
    checkedInCount,
    notCheckedInCount,
    duplicateScanAttempts,
    invalidScanAttempts,
    validationSuccessRate
  };
}
