import { and, eq, inArray, isNull, lt, isNotNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { emailSubscribers } from '../../../db/schema/email-subscribers.js';
import { attendees } from '../../../db/schema/attendees.js';
import { events } from '../../../db/schema/events.js';
import { eventTags } from '../../../db/schema/event-tags.js';
import { tags } from '../../../db/schema/tags.js';

export interface SegmentFilters {
  type:
    | 'all_subscribers'
    | 'event_attendees'
    | 'previous_attendees'
    | 'custom_uploads'
    | 'event_category'
    | 'event_tags'
    | 'location'
    | 'specific_events';
  categoryId?: string;
  tags?: string[];
  city?: string;
  country?: string;
  eventIds?: string[];
  attendedOnly?: boolean;
}

/**
 * Resolves a segment's criteria to return matching subscriber records from the database.
 */
export async function resolveSegmentSubscribers(
  database: typeof db,
  tenantId: string,
  filters: SegmentFilters
) {
  // Base condition: only active (subscribed) subscribers for this tenant
  const conditions = [
    eq(emailSubscribers.tenantId, tenantId),
    eq(emailSubscribers.status, 'subscribed')
  ];

  switch (filters.type) {
    case 'all_subscribers':
      // No additional filters needed
      break;

    case 'event_attendees': {
      const subquery = database
        .select({ email: attendees.email })
        .from(attendees)
        .where(
          and(
            eq(attendees.tenantId, tenantId),
            isNull(attendees.deletedAt)
          )
        );
      conditions.push(inArray(emailSubscribers.email, subquery));
      break;
    }

    case 'previous_attendees': {
      const now = new Date();
      const subquery = database
        .select({ email: attendees.email })
        .from(attendees)
        .innerJoin(events, eq(attendees.eventId, events.id))
        .where(
          and(
            eq(attendees.tenantId, tenantId),
            lt(events.endDateTime, now),
            isNull(attendees.deletedAt),
            isNull(events.deletedAt)
          )
        );
      conditions.push(inArray(emailSubscribers.email, subquery));
      break;
    }

    case 'custom_uploads':
      conditions.push(eq(emailSubscribers.source, 'csv_import'));
      break;

    case 'event_category': {
      if (!filters.categoryId) {
        throw new Error('categoryId is required for event_category filter');
      }
      const subquery = database
        .select({ email: attendees.email })
        .from(attendees)
        .innerJoin(events, eq(attendees.eventId, events.id))
        .where(
          and(
            eq(attendees.tenantId, tenantId),
            eq(events.categoryId, filters.categoryId),
            isNull(attendees.deletedAt),
            isNull(events.deletedAt)
          )
        );
      conditions.push(inArray(emailSubscribers.email, subquery));
      break;
    }

    case 'event_tags': {
      if (!filters.tags || filters.tags.length === 0) {
        throw new Error('tags array is required for event_tags filter');
      }
      const subquery = database
        .select({ email: attendees.email })
        .from(attendees)
        .innerJoin(events, eq(attendees.eventId, events.id))
        .innerJoin(eventTags, eq(eventTags.eventId, events.id))
        .innerJoin(tags, eq(tags.id, eventTags.tagId))
        .where(
          and(
            eq(attendees.tenantId, tenantId),
            inArray(tags.name, filters.tags),
            isNull(attendees.deletedAt),
            isNull(events.deletedAt)
          )
        );
      conditions.push(inArray(emailSubscribers.email, subquery));
      break;
    }

    case 'location': {
      const locationConditions = [
        eq(attendees.tenantId, tenantId),
        isNull(attendees.deletedAt)
      ];
      if (filters.city) {
        locationConditions.push(eq(attendees.city, filters.city));
      }
      if (filters.country) {
        locationConditions.push(eq(attendees.country, filters.country));
      }
      const subquery = database
        .select({ email: attendees.email })
        .from(attendees)
        .where(and(...locationConditions));
      conditions.push(inArray(emailSubscribers.email, subquery));
      break;
    }

    case 'specific_events': {
      if (!filters.eventIds || filters.eventIds.length === 0) {
        throw new Error('eventIds array is required for specific_events filter');
      }
      const eventConditions = [
        eq(attendees.tenantId, tenantId),
        inArray(attendees.eventId, filters.eventIds),
        isNull(attendees.deletedAt)
      ];
      if (filters.attendedOnly) {
        eventConditions.push(
          and(
            isNotNull(attendees.checkedInAt),
            eq(attendees.status, 'checked_in')
          )!
        );
      }
      const subquery = database
        .select({ email: attendees.email })
        .from(attendees)
        .where(and(...eventConditions));
      conditions.push(inArray(emailSubscribers.email, subquery));
      break;
    }

    default:
      throw new Error(`Unsupported segment filter type: ${(filters as any).type}`);
  }

  return database
    .select()
    .from(emailSubscribers)
    .where(and(...conditions));
}
