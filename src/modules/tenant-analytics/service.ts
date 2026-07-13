import { notFound } from '../../lib/errors.js';
import * as repository from './repository.js';
import type {
  TenantDashboardResponse,
  TenantAnalyticsResponse,
  TenantTopEventItem,
  TenantUpcomingEventItem,
  TenantActivityFeedItem,
  TenantHealthResponse
} from './types.js';
import type { TenantActivityQuery, TopEventsQuery } from './validation.js';

export async function calculateHealthStatus(tenantId: string, rawMetrics: any) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // 1. Booking Growth
  const recentBookings = await repository.getConfirmedBookingCountInDateRange(tenantId, thirtyDaysAgo, now);
  const priorBookings = await repository.getConfirmedBookingCountInDateRange(tenantId, sixtyDaysAgo, thirtyDaysAgo);
  const bookingGrowth = priorBookings === 0
    ? (recentBookings > 0 ? 100 : 0)
    : ((recentBookings - priorBookings) / priorBookings) * 100;
  const bookingGrowthScore = bookingGrowth >= 0 ? 100 : Math.max(0, 100 + bookingGrowth);

  // 2. Event Utilization
  const totalCapacity = rawMetrics.ticketsSold + rawMetrics.ticketsAvailable + rawMetrics.ticketsReserved;
  const utilizationScore = totalCapacity > 0 ? (rawMetrics.ticketsSold / totalCapacity) * 100 : 100;

  // 3. Check-In Success Rate
  const checkinScore = rawMetrics.attendeesRegistered > 0
    ? (rawMetrics.attendeesCheckedIn / rawMetrics.attendeesRegistered) * 100
    : 100;

  // 4. Cancellation Ratio
  let totalBookings = 0;
  let cancelledBookings = 0;
  for (const row of rawMetrics.bookingCounts) {
    totalBookings += row.count;
    if (row.status === 'cancelled') {
      cancelledBookings += row.count;
    }
  }
  const cancellationRatio = totalBookings > 0 ? (cancelledBookings / totalBookings) * 100 : 0;
  const cancellationScore = 100 - cancellationRatio;

  // 5. Validation Failure Ratio
  const validationFailureRatio = rawMetrics.totalScanAttempts > 0
    ? (rawMetrics.validationFailures / rawMetrics.totalScanAttempts) * 100
    : 0;
  const validationFailureScore = Math.max(0, 100 - (validationFailureRatio * 4));

  // Compute overall health score
  const healthScore = Math.round(
    (bookingGrowthScore * 0.20) +
    (utilizationScore * 0.20) +
    (checkinScore * 0.20) +
    (cancellationScore * 0.20) +
    (validationFailureScore * 0.20)
  );

  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (healthScore < 50) {
    status = 'critical';
  } else if (healthScore < 80) {
    status = 'warning';
  }

  return status;
}

export async function getDashboardSummary(tenantId: string, slug: string): Promise<TenantDashboardResponse> {
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) {
    throw notFound('Tenant not found');
  }

  const raw = await repository.getDashboardRawMetrics(tenantId);

  // Map bookings
  let totalBookings = 0;
  let confirmedBookings = 0;
  let cancelledBookings = 0;

  for (const row of raw.bookingCounts) {
    totalBookings += row.count;
    if (['confirmed', 'paid', 'completed'].includes(row.status)) {
      confirmedBookings += row.count;
    } else if (row.status === 'cancelled') {
      cancelledBookings += row.count;
    }
  }

  // Map revenue
  let grossRevenueDecimal = 0;
  for (const row of raw.bookingCounts) {
    if (['confirmed', 'paid', 'completed'].includes(row.status)) {
      grossRevenueDecimal += parseFloat(row.revenue);
    }
  }
  const grossRevenue = Math.round(grossRevenueDecimal * 100);

  // Calculate health
  const healthScore = await calculateHealthStatus(tenantId, raw);

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    totalEvents: raw.eventCounts.total,
    publishedEvents: raw.eventCounts.published,
    upcomingEvents: raw.eventCounts.upcoming,
    completedEvents: raw.eventCounts.completed,
    ticketsSold: raw.ticketsSold,
    ticketsAvailable: raw.ticketsAvailable,
    totalBookings,
    confirmedBookings,
    cancelledBookings,
    attendeesRegistered: raw.attendeesRegistered,
    attendeesCheckedIn: raw.attendeesCheckedIn,
    grossRevenue,
    healthScore,
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
): Promise<TenantAnalyticsResponse> {
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) {
    throw notFound('Tenant not found');
  }

  // 1. Sales Timeseries
  const salesDaily = await repository.getSalesTimeseries(tenantId, 'day', startDate, endDate);
  const salesWeekly = await repository.getSalesTimeseries(tenantId, 'week', startDate, endDate);
  const salesMonthly = await repository.getSalesTimeseries(tenantId, 'month', startDate, endDate);

  // 2. Revenue Timeseries
  const revenueDaily = await repository.getRevenueTimeseries(tenantId, 'day', startDate, endDate);
  const revenueWeekly = await repository.getRevenueTimeseries(tenantId, 'week', startDate, endDate);
  const revenueMonthly = await repository.getRevenueTimeseries(tenantId, 'month', startDate, endDate);

  // 3. Booking Timeseries & conversion metrics
  const bookingsDaily = await repository.getBookingTimeseries(tenantId, 'day', startDate, endDate);
  const bookingsWeekly = await repository.getBookingTimeseries(tenantId, 'week', startDate, endDate);
  const bookingsMonthly = await repository.getBookingTimeseries(tenantId, 'month', startDate, endDate);

  const raw = await repository.getDashboardRawMetrics(tenantId);
  let totalBookings = 0;
  let confirmedBookings = 0;
  let cancelledBookings = 0;
  for (const row of raw.bookingCounts) {
    totalBookings += row.count;
    if (['confirmed', 'paid', 'completed'].includes(row.status)) {
      confirmedBookings += row.count;
    } else if (row.status === 'cancelled') {
      cancelledBookings += row.count;
    }
  }
  const conversionRate = totalBookings > 0 ? Number(((confirmedBookings / totalBookings) * 100).toFixed(1)) : 0.0;

  // 4. Attendee Timeseries & assignment rate
  const attendeeDaily = await repository.getAttendeeGrowthTimeseries(tenantId, 'day', startDate, endDate);
  const attendeeWeekly = await repository.getAttendeeGrowthTimeseries(tenantId, 'week', startDate, endDate);
  const attendeeMonthly = await repository.getAttendeeGrowthTimeseries(tenantId, 'month', startDate, endDate);

  const activeAssignments = await repository.getAttendeeAssignmentRate(tenantId);
  const assignmentRate = raw.ticketsSold > 0 ? Number(((activeAssignments / raw.ticketsSold) * 100).toFixed(1)) : 0.0;

  // 5. Check-In Timeseries & attendance percentages
  const checkinDaily = await repository.getCheckinTimeseries(tenantId, 'day', startDate, endDate);
  const checkinWeekly = await repository.getCheckinTimeseries(tenantId, 'week', startDate, endDate);
  const checkinMonthly = await repository.getCheckinTimeseries(tenantId, 'month', startDate, endDate);
  const attendancePercentage = raw.attendeesRegistered > 0
    ? Number(((raw.attendeesCheckedIn / raw.attendeesRegistered) * 100).toFixed(1))
    : 0.0;

  // 6. Marketing Timeseries & campaign stats
  const subscriberDaily = await repository.getSubscriberGrowthTimeseries(tenantId, 'day', startDate, endDate);
  const subscriberWeekly = await repository.getSubscriberGrowthTimeseries(tenantId, 'week', startDate, endDate);
  const subscriberMonthly = await repository.getSubscriberGrowthTimeseries(tenantId, 'month', startDate, endDate);
  const campaignStats = await repository.getMarketingCampaignStats(tenantId);

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
    bookings: {
      daily: bookingsDaily,
      weekly: bookingsWeekly,
      monthly: bookingsMonthly,
      total: totalBookings,
      confirmed: confirmedBookings,
      cancelled: cancelledBookings,
      conversionRate
    },
    attendee: {
      dailyGrowth: attendeeDaily,
      weeklyGrowth: attendeeWeekly,
      monthlyGrowth: attendeeMonthly,
      assignmentRate
    },
    checkIn: {
      dailyCheckIns: checkinDaily,
      weeklyCheckIns: checkinWeekly,
      monthlyCheckIns: checkinMonthly,
      attendancePercentage
    },
    marketing: {
      dailySubscriberGrowth: subscriberDaily,
      weeklySubscriberGrowth: subscriberWeekly,
      monthlySubscriberGrowth: subscriberMonthly,
      campaignsCount: campaignStats.totalCampaigns,
      emailSends: campaignStats.sends,
      opens: campaignStats.opens,
      clicks: campaignStats.clicks,
      unsubscribes: campaignStats.unsubscribes
    },
    lastUpdatedAt: new Date().toISOString()
  };
}

export async function getTopEvents(
  tenantId: string,
  slug: string,
  query: TopEventsQuery
): Promise<TenantTopEventItem[]> {
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) {
    throw notFound('Tenant not found');
  }

  const rows = await repository.getTopEvents(tenantId, query.sortBy, query.sortOrder, query.limit);

  return rows.map((row) => ({
    eventName: row.eventName,
    ticketsSold: row.ticketsSold,
    attendees: row.attendees,
    revenue: row.revenue,
    checkIns: row.checkIns
  }));
}

export async function getUpcomingEvents(tenantId: string, slug: string): Promise<TenantUpcomingEventItem[]> {
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) {
    throw notFound('Tenant not found');
  }

  const rows = await repository.getUpcomingEvents(tenantId);

  return rows.map((row) => ({
    eventName: row.eventName,
    startDate: row.startDate ? row.startDate.toISOString() : '',
    ticketsSold: row.ticketsSold,
    utilizationPercentage: row.totalCapacity > 0 ? Number(((row.ticketsSold / row.totalCapacity) * 100).toFixed(1)) : 0.0
  }));
}

export async function getTenantActivityFeed(
  tenantId: string,
  slug: string,
  query: TenantActivityQuery
): Promise<TenantActivityFeedItem[]> {
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) {
    throw notFound('Tenant not found');
  }

  const raw = await repository.getTenantActivityFeed(
    tenantId,
    query.limit ?? 50,
    query.cursor,
    query.type ? query.type.split(',').map((t) => t.trim()) : undefined,
    query.startDate,
    query.endDate
  );

  return raw.map((row) => ({
    id: row.id,
    activityType: row.activity_type,
    createdAt: new Date(row.created_at).toISOString(),
    actorUserId: row.actor_user_id,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
  }));
}

export async function getHealth(tenantId: string, slug: string): Promise<TenantHealthResponse> {
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) {
    throw notFound('Tenant not found');
  }

  const raw = await repository.getDashboardRawMetrics(tenantId);
  const status = await calculateHealthStatus(tenantId, raw);

  return {
    status
  };
}
