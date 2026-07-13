export interface TenantDashboardResponse {
  tenantId: string;
  tenantName: string;
  totalEvents: number;
  publishedEvents: number;
  upcomingEvents: number;
  completedEvents: number;
  ticketsSold: number;
  ticketsAvailable: number;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  attendeesRegistered: number;
  attendeesCheckedIn: number;
  grossRevenue: number;
  healthScore: 'healthy' | 'warning' | 'critical';
  groupBookingsCreated: number;
  groupBookingsCompleted: number;
  groupBookingsAverageSize: number;
  groupBookingsRevenue: number;
  lastUpdatedAt: string;
}

export interface TimeseriesItem {
  date: string;
  count: number;
}

export interface RevenueTimeseriesItem {
  date: string;
  revenue: number;
}

export interface TenantAnalyticsResponse {
  sales: {
    daily: TimeseriesItem[];
    weekly: TimeseriesItem[];
    monthly: TimeseriesItem[];
  };
  revenue: {
    daily: RevenueTimeseriesItem[];
    weekly: RevenueTimeseriesItem[];
    monthly: RevenueTimeseriesItem[];
  };
  bookings: {
    daily: TimeseriesItem[];
    weekly: TimeseriesItem[];
    monthly: TimeseriesItem[];
    total: number;
    confirmed: number;
    cancelled: number;
    conversionRate: number;
  };
  attendee: {
    dailyGrowth: TimeseriesItem[];
    weeklyGrowth: TimeseriesItem[];
    monthlyGrowth: TimeseriesItem[];
    assignmentRate: number;
  };
  checkIn: {
    dailyCheckIns: TimeseriesItem[];
    weeklyCheckIns: TimeseriesItem[];
    monthlyCheckIns: TimeseriesItem[];
    attendancePercentage: number;
  };
  marketing: {
    dailySubscriberGrowth: TimeseriesItem[];
    weeklySubscriberGrowth: TimeseriesItem[];
    monthlySubscriberGrowth: TimeseriesItem[];
    campaignsCount: number;
    emailSends: number;
    opens: number;
    clicks: number;
    unsubscribes: number;
  };
  lastUpdatedAt: string;
}

export interface TenantTopEventItem {
  eventName: string;
  ticketsSold: number;
  attendees: number;
  revenue: number;
  checkIns: number;
}

export interface TenantUpcomingEventItem {
  eventName: string;
  startDate: string;
  ticketsSold: number;
  utilizationPercentage: number;
}

export interface TenantActivityFeedItem {
  id: string;
  activityType: string;
  createdAt: string;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
}

export interface TenantHealthResponse {
  status: 'healthy' | 'warning' | 'critical';
}
