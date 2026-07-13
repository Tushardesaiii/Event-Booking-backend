export interface DashboardSummaryResponse {
  eventId: string;
  eventName: string;
  ticketsSold: number;
  ticketsAvailable: number;
  ticketsReserved: number;
  bookingsTotal: number;
  bookingsPending: number;
  bookingsConfirmed: number;
  bookingsCancelled: number;
  attendeesRegistered: number;
  ticketsCheckedIn: number;
  ticketsNotCheckedIn: number;
  checkInRate: number;
  grossRevenue: number;
  estimatedRevenue: number;
  healthScore: number;
  healthStatus: 'Healthy' | 'Warning' | 'Critical';
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

export interface TicketTypeBreakdown {
  ticketTypeId: string;
  name: string;
  slug: string;
  soldQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  checkInCount: number;
  revenueContribution: number;
  utilizationPercentage: number;
}

export interface BookingAnalytics {
  total: number;
  confirmed: number;
  cancelled: number;
  expired: number;
  refunded: number;
  partiallyRefunded: number;
}

export interface AttendeeAnalytics {
  registrations: number;
  assignmentRate: number;
}

export interface HourlyCheckinItem {
  hour: string;
  count: number;
}

export interface DailyCheckinItem {
  day: string;
  count: number;
}

export interface CheckinAnalytics {
  byHour: HourlyCheckinItem[];
  byDay: DailyCheckinItem[];
}

export interface ConversionMetrics {
  reservationToBookingRate: number;
  bookingToConfirmedRate: number;
}

export interface AdvancedAnalyticsResponse {
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
  ticketTypes: TicketTypeBreakdown[];
  bookings: BookingAnalytics;
  attendees: AttendeeAnalytics;
  checkins: CheckinAnalytics;
  conversions: ConversionMetrics;
  lastUpdatedAt: string;
}

export interface LiveStatusResponse {
  currentlyCheckedIn: number;
  remainingExpected: number;
  currentCheckInRate: string;
  activeScanners: number;
  lastScanAt: string | null;
  validationFailuresToday: number;
}

export interface ActivityFeedItem {
  id: string;
  activityType: string;
  createdAt: string;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
}

export interface ActivityFeedQuery {
  limit?: number;
  cursor?: string;
  type?: string;
}
