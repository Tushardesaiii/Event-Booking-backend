// src/modules/artist/services/analyticsService.ts
import { db } from '../../../db/client.js';
import { artistFollowers, artistStories, eventArtists, artistStoryViews, artistStoryReactions } from '../../../db/schema/artist.js';
import { events } from '../../../db/schema/events.js';
import { issuedTickets } from '../../../db/schema/issued-tickets.js';
import { eq, and, count, gt, inArray, isNull, sql } from 'drizzle-orm';

export class AnalyticsService {
  async getArtistDashboard(tenantId: string, artistId: string) {
    const now = new Date();

    const [followerResult] = await db
      .select({ count: count() })
      .from(artistFollowers)
      .where(and(eq(artistFollowers.tenantId, tenantId), eq(artistFollowers.artistId, artistId)));

    const [eventsResult] = await db
      .select({ count: count() })
      .from(eventArtists)
      .innerJoin(events, eq(events.id, eventArtists.eventId))
      .where(
        and(
          eq(eventArtists.tenantId, tenantId),
          eq(eventArtists.artistId, artistId),
          gt(events.endDateTime, now)
        )
      );

    const [storiesResult] = await db
      .select({ count: count() })
      .from(artistStories)
      .where(
        and(
          eq(artistStories.tenantId, tenantId),
          eq(artistStories.artistId, artistId),
          gt(artistStories.expiresAt, now)
        )
      );

    // Derived Attendance Count
    const [attendanceResult] = await db
      .select({ count: count() })
      .from(issuedTickets)
      .innerJoin(eventArtists, eq(eventArtists.eventId, issuedTickets.eventId))
      .where(
        and(
          eq(eventArtists.tenantId, tenantId),
          eq(eventArtists.artistId, artistId),
          eq(issuedTickets.status, 'checked_in'),
          isNull(issuedTickets.deletedAt)
        )
      );

    // Derived Ticket Sales Count (active tickets: issued or checked_in)
    const [salesResult] = await db
      .select({ count: count() })
      .from(issuedTickets)
      .innerJoin(eventArtists, eq(eventArtists.eventId, issuedTickets.eventId))
      .where(
        and(
          eq(eventArtists.tenantId, tenantId),
          eq(eventArtists.artistId, artistId),
          inArray(issuedTickets.status, ['issued', 'checked_in']),
          isNull(issuedTickets.deletedAt)
        )
      );

    // Derived Gross Revenue (sum of unit prices of active tickets)
    const [revenueResult] = await db
      .select({ sum: sql<string>`coalesce(sum(${issuedTickets.unitPriceSnapshot}), '0')` })
      .from(issuedTickets)
      .innerJoin(eventArtists, eq(eventArtists.eventId, issuedTickets.eventId))
      .where(
        and(
          eq(eventArtists.tenantId, tenantId),
          eq(eventArtists.artistId, artistId),
          inArray(issuedTickets.status, ['issued', 'checked_in']),
          isNull(issuedTickets.deletedAt)
        )
      );

    // Derived Story Views
    const [viewsResult] = await db
      .select({ count: count() })
      .from(artistStoryViews)
      .innerJoin(artistStories, eq(artistStories.id, artistStoryViews.storyId))
      .where(
        and(
          eq(artistStoryViews.tenantId, tenantId),
          eq(artistStories.artistId, artistId)
        )
      );

    // Derived Story Engagement (reactions count)
    const [reactionsResult] = await db
      .select({ count: count() })
      .from(artistStoryReactions)
      .innerJoin(artistStories, eq(artistStories.id, artistStoryReactions.storyId))
      .where(
        and(
          eq(artistStoryReactions.tenantId, tenantId),
          eq(artistStories.artistId, artistId)
        )
      );

    return {
      followersCount: Number(followerResult?.count ?? 0),
      upcomingEventsCount: Number(eventsResult?.count ?? 0),
      activeStoriesCount: Number(storiesResult?.count ?? 0),
      attendanceCount: Number(attendanceResult?.count ?? 0),
      ticketSales: Number(salesResult?.count ?? 0),
      revenue: parseFloat(revenueResult?.sum ?? '0'),
      storyViews: Number(viewsResult?.count ?? 0),
      storyEngagement: Number(reactionsResult?.count ?? 0)
    };
  }
}

export const analyticsService = new AnalyticsService();
