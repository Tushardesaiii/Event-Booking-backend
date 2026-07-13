import { relations } from 'drizzle-orm';

import { assets } from './assets.js';
import { auditLogs } from './audit-logs.js';
import { authAccounts } from './auth-accounts.js';
import { bookingOrderCounters } from './booking-order-counters.js';
import { bookingOrderItemAttendees } from './booking-order-item-attendees.js';
import { bookingOrderItems } from './booking-order-items.js';
import { bookingOrders } from './booking-orders.js';
import { categories } from './categories.js';
import { issuedTicketCounters } from './issued-ticket-counters.js';
import { issuedTicketEvents } from './issued-ticket-events.js';
import { issuedTickets } from './issued-tickets.js';
import { eventSeries } from './event-series.js';
import { eventTags } from './event-tags.js';
import { events } from './events.js';
import { attendees } from './attendees.js';
import { sessions } from './sessions.js';
import { signupVerificationSessions } from './signup-verification-sessions.js';
import { ticketTypes } from './ticket-types.js';
import { tags } from './tags.js';
import { tenantMembers } from './tenant-members.js';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { verificationTokens } from './verification-tokens.js';
import { venues } from './venues.js';
import { emailTemplates } from './email-templates.js';
import { emailCampaigns } from './email-campaigns.js';
import { emailSegments } from './email-segments.js';
import { emailSubscribers } from './email-subscribers.js';
import { emailCampaignRecipients } from './email-campaign-recipients.js';
import { emailOutbox } from './email-outbox.js';
import { emailEvents } from './email-events.js';
import { emailSuppressions } from './email-suppressions.js';
import { mediaAssets, mediaLinks } from '../../modules/media/schema.js';

export const usersRelations = relations(users, ({ many, one }) => ({
  avatarAsset: one(assets, {
    fields: [users.avatarAssetId],
    references: [assets.id]
  }),
  uploadedAssets: many(assets),
  authAccounts: many(authAccounts),
  sessions: many(sessions),
  createdTenants: many(tenants),
  createdEvents: many(events, {
    relationName: 'event_created_by'
  }),
  updatedEvents: many(events, {
    relationName: 'event_updated_by'
  }),
  memberships: many(tenantMembers),
  invitedMemberships: many(tenantMembers),
  verificationTokens: many(verificationTokens),
  auditLogs: many(auditLogs),
  emailCampaigns: many(emailCampaigns),
  emailSubscribers: many(emailSubscribers)
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, {
    fields: [authAccounts.userId],
    references: [users.id]
  })
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id]
  })
}));

export const signupVerificationSessionsRelations = relations(signupVerificationSessions, () => ({}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actorUser: one(users, {
    fields: [auditLogs.actorUserId],
    references: [users.id]
  })
}));

export const verificationTokensRelations = relations(verificationTokens, ({ one }) => ({
  user: one(users, {
    fields: [verificationTokens.userId],
    references: [users.id]
  })
}));

export const assetsRelations = relations(assets, ({ one }) => ({
  uploadedByUser: one(users, {
    fields: [assets.uploadedBy],
    references: [users.id]
  })
}));

export const tenantsRelations = relations(tenants, ({ many, one }) => ({
  creator: one(users, {
    fields: [tenants.createdByUserId],
    references: [users.id]
  }),
  logoAsset: one(assets, {
    fields: [tenants.logoAssetId],
    references: [assets.id]
  }),
  coverAsset: one(assets, {
    fields: [tenants.coverAssetId],
    references: [assets.id]
  }),
  members: many(tenantMembers),
  venues: many(venues),
  eventSeries: many(eventSeries),
  events: many(events),
  ticketTypes: many(ticketTypes),
  attendees: many(attendees),
  bookingOrders: many(bookingOrders),
  bookingOrderCounters: many(bookingOrderCounters),
  issuedTickets: many(issuedTickets),
  issuedTicketCounters: many(issuedTicketCounters),
  emailTemplates: many(emailTemplates),
  emailCampaigns: many(emailCampaigns),
  emailSegments: many(emailSegments),
  emailSubscribers: many(emailSubscribers),
  emailCampaignRecipients: many(emailCampaignRecipients),
  emailOutbox: many(emailOutbox),
  emailEvents: many(emailEvents),
  emailSuppressions: many(emailSuppressions)
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenantId],
    references: [tenants.id]
  }),
  user: one(users, {
    fields: [tenantMembers.userId],
    references: [users.id]
  }),
  invitedByUser: one(users, {
    fields: [tenantMembers.invitedByUserId],
    references: [users.id]
  })
}));

export const venuesRelations = relations(venues, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [venues.tenantId],
    references: [tenants.id]
  }),
  coverAsset: one(assets, {
    fields: [venues.coverAssetId],
    references: [assets.id]
  }),
  createdByUser: one(users, {
    fields: [venues.createdByUserId],
    references: [users.id]
  }),
  updatedByUser: one(users, {
    fields: [venues.updatedByUserId],
    references: [users.id]
  }),
  events: many(events)
}));

export const eventSeriesRelations = relations(eventSeries, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [eventSeries.tenantId],
    references: [tenants.id]
  }),
  createdByUser: one(users, {
    fields: [eventSeries.createdByUserId],
    references: [users.id]
  }),
  updatedByUser: one(users, {
    fields: [eventSeries.updatedByUserId],
    references: [users.id]
  }),
  events: many(events)
}));

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  tenant: one(tenants, {
    fields: [categories.tenantId],
    references: [tenants.id]
  }),
  createdByUser: one(users, {
    fields: [categories.createdByUserId],
    references: [users.id]
  }),
  updatedByUser: one(users, {
    fields: [categories.updatedByUserId],
    references: [users.id]
  }),
  events: many(events)
}));

export const tagsRelations = relations(tags, ({ many, one }) => ({
  tenant: one(tenants, {
    fields: [tags.tenantId],
    references: [tenants.id]
  }),
  createdByUser: one(users, {
    fields: [tags.createdByUserId],
    references: [users.id]
  }),
  updatedByUser: one(users, {
    fields: [tags.updatedByUserId],
    references: [users.id]
  }),
  eventTags: many(eventTags)
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [events.tenantId],
    references: [tenants.id]
  }),
  venue: one(venues, {
    fields: [events.venueId],
    references: [venues.id]
  }),
  series: one(eventSeries, {
    fields: [events.eventSeriesId],
    references: [eventSeries.id]
  }),
  category: one(categories, {
    fields: [events.categoryId],
    references: [categories.id]
  }),
  bannerAsset: one(assets, {
    fields: [events.bannerAssetId],
    references: [assets.id]
  }),
  thumbnailAsset: one(assets, {
    fields: [events.thumbnailAssetId],
    references: [assets.id]
  }),
  createdByUser: one(users, {
    fields: [events.createdByUserId],
    references: [users.id],
    relationName: 'event_created_by'
  }),
  updatedByUser: one(users, {
    fields: [events.updatedByUserId],
    references: [users.id],
    relationName: 'event_updated_by'
  }),
  eventTags: many(eventTags),
  ticketTypes: many(ticketTypes),
  attendees: many(attendees),
  bookingOrders: many(bookingOrders),
  bookingOrderCounters: many(bookingOrderCounters),
  issuedTickets: many(issuedTickets),
  issuedTicketCounters: many(issuedTicketCounters)
}));

export const eventTagsRelations = relations(eventTags, ({ one }) => ({
  tenant: one(tenants, {
    fields: [eventTags.tenantId],
    references: [tenants.id]
  }),
  event: one(events, {
    fields: [eventTags.eventId],
    references: [events.id]
  }),
  tag: one(tags, {
    fields: [eventTags.tagId],
    references: [tags.id]
  })
}));

export const ticketTypesRelations = relations(ticketTypes, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [ticketTypes.tenantId],
    references: [tenants.id]
  }),
  event: one(events, {
    fields: [ticketTypes.eventId],
    references: [events.id]
  }),
  createdByUser: one(users, {
    fields: [ticketTypes.createdByUserId],
    references: [users.id],
    relationName: 'ticket_created_by'
  }),
  updatedByUser: one(users, {
    fields: [ticketTypes.updatedByUserId],
    references: [users.id],
    relationName: 'ticket_updated_by'
  }),
  issuedTickets: many(issuedTickets),
  issuedTicketCounters: many(issuedTicketCounters)
}));

export const bookingOrdersRelations = relations(bookingOrders, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [bookingOrders.tenantId],
    references: [tenants.id]
  }),
  event: one(events, {
    fields: [bookingOrders.eventId],
    references: [events.id]
  }),
  purchaserUser: one(users, {
    fields: [bookingOrders.purchaserUserId],
    references: [users.id],
    relationName: 'booking_order_purchaser'
  }),
  createdByUser: one(users, {
    fields: [bookingOrders.createdByUserId],
    references: [users.id],
    relationName: 'booking_order_created_by'
  }),
  updatedByUser: one(users, {
    fields: [bookingOrders.updatedByUserId],
    references: [users.id],
    relationName: 'booking_order_updated_by'
  }),
  items: many(bookingOrderItems),
  assignments: many(bookingOrderItemAttendees),
  issuedTickets: many(issuedTickets)
}));

export const bookingOrderItemsRelations = relations(bookingOrderItems, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [bookingOrderItems.tenantId],
    references: [tenants.id]
  }),
  bookingOrder: one(bookingOrders, {
    fields: [bookingOrderItems.bookingOrderId],
    references: [bookingOrders.id]
  }),
  ticketType: one(ticketTypes, {
    fields: [bookingOrderItems.ticketTypeId],
    references: [ticketTypes.id]
  }),
  attendees: many(bookingOrderItemAttendees),
  issuedTickets: many(issuedTickets)
}));

export const bookingOrderItemAttendeesRelations = relations(bookingOrderItemAttendees, ({ one }) => ({
  tenant: one(tenants, {
    fields: [bookingOrderItemAttendees.tenantId],
    references: [tenants.id]
  }),
  bookingOrder: one(bookingOrders, {
    fields: [bookingOrderItemAttendees.bookingOrderId],
    references: [bookingOrders.id]
  }),
  bookingOrderItem: one(bookingOrderItems, {
    fields: [bookingOrderItemAttendees.bookingOrderItemId],
    references: [bookingOrderItems.id]
  }),
  attendee: one(attendees, {
    fields: [bookingOrderItemAttendees.attendeeId],
    references: [attendees.id]
  }),
  assignedByUser: one(users, {
    fields: [bookingOrderItemAttendees.assignedByUserId],
    references: [users.id],
    relationName: 'booking_order_assignment_assigned_by'
  })
}));

export const attendeesRelations = relations(attendees, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [attendees.tenantId],
    references: [tenants.id]
  }),
  event: one(events, {
    fields: [attendees.eventId],
    references: [events.id]
  }),
  ticketType: one(ticketTypes, {
    fields: [attendees.ticketTypeId],
    references: [ticketTypes.id]
  }),
  checkedInByUser: one(users, {
    fields: [attendees.checkedInByUserId],
    references: [users.id],
    relationName: 'attendee_checked_in_by'
  }),
  createdByUser: one(users, {
    fields: [attendees.createdByUserId],
    references: [users.id],
    relationName: 'attendee_created_by'
  }),
  updatedByUser: one(users, {
    fields: [attendees.updatedByUserId],
    references: [users.id],
    relationName: 'attendee_updated_by'
  }),
  issuedTickets: many(issuedTickets)
}));

export const issuedTicketCountersRelations = relations(issuedTicketCounters, ({ one }) => ({
  tenant: one(tenants, {
    fields: [issuedTicketCounters.tenantId],
    references: [tenants.id]
  }),
  event: one(events, {
    fields: [issuedTicketCounters.eventId],
    references: [events.id]
  }),
  ticketType: one(ticketTypes, {
    fields: [issuedTicketCounters.ticketTypeId],
    references: [ticketTypes.id]
  })
}));

export const issuedTicketsRelations = relations(issuedTickets, ({ one }) => ({
  tenant: one(tenants, {
    fields: [issuedTickets.tenantId],
    references: [tenants.id]
  }),
  event: one(events, {
    fields: [issuedTickets.eventId],
    references: [events.id]
  }),
  ticketType: one(ticketTypes, {
    fields: [issuedTickets.ticketTypeId],
    references: [ticketTypes.id]
  }),
  attendee: one(attendees, {
    fields: [issuedTickets.attendeeId],
    references: [attendees.id]
  }),
  bookingOrder: one(bookingOrders, {
    fields: [issuedTickets.bookingOrderId],
    references: [bookingOrders.id]
  }),
  bookingOrderItem: one(bookingOrderItems, {
    fields: [issuedTickets.bookingOrderItemId],
    references: [bookingOrderItems.id]
  })
}));

export const issuedTicketEventsRelations = relations(issuedTicketEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [issuedTicketEvents.tenantId],
    references: [tenants.id]
  }),
  issuedTicket: one(issuedTickets, {
    fields: [issuedTicketEvents.issuedTicketId],
    references: [issuedTickets.id]
  }),
  actorUser: one(users, {
    fields: [issuedTicketEvents.actorUserId],
    references: [users.id]
  }),
  scannerOperatorUser: one(users, {
    fields: [issuedTicketEvents.scannerOperatorUserId],
    references: [users.id]
  })
}));

export const emailTemplatesRelations = relations(emailTemplates, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [emailTemplates.tenantId],
    references: [tenants.id]
  }),
  campaigns: many(emailCampaigns)
}));

export const emailCampaignsRelations = relations(emailCampaigns, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [emailCampaigns.tenantId],
    references: [tenants.id]
  }),
  template: one(emailTemplates, {
    fields: [emailCampaigns.templateId],
    references: [emailTemplates.id]
  }),
  segment: one(emailSegments, {
    fields: [emailCampaigns.segmentId],
    references: [emailSegments.id]
  }),
  createdBy: one(users, {
    fields: [emailCampaigns.createdByUserId],
    references: [users.id]
  }),
  recipients: many(emailCampaignRecipients),
  outboxItems: many(emailOutbox),
  events: many(emailEvents),
  suppressions: many(emailSuppressions)
}));

export const emailSegmentsRelations = relations(emailSegments, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [emailSegments.tenantId],
    references: [tenants.id]
  }),
  campaigns: many(emailCampaigns)
}));

export const emailSubscribersRelations = relations(emailSubscribers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [emailSubscribers.tenantId],
    references: [tenants.id]
  }),
  user: one(users, {
    fields: [emailSubscribers.userId],
    references: [users.id]
  }),
  recipients: many(emailCampaignRecipients),
  suppressions: many(emailSuppressions)
}));

export const emailCampaignRecipientsRelations = relations(emailCampaignRecipients, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [emailCampaignRecipients.tenantId],
    references: [tenants.id]
  }),
  campaign: one(emailCampaigns, {
    fields: [emailCampaignRecipients.campaignId],
    references: [emailCampaigns.id]
  }),
  subscriber: one(emailSubscribers, {
    fields: [emailCampaignRecipients.subscriberId],
    references: [emailSubscribers.id]
  }),
  outboxItems: many(emailOutbox),
  events: many(emailEvents)
}));

export const emailOutboxRelations = relations(emailOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [emailOutbox.tenantId],
    references: [tenants.id]
  }),
  campaign: one(emailCampaigns, {
    fields: [emailOutbox.campaignId],
    references: [emailCampaigns.id]
  }),
  recipient: one(emailCampaignRecipients, {
    fields: [emailOutbox.recipientId],
    references: [emailCampaignRecipients.id]
  })
}));

export const emailEventsRelations = relations(emailEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [emailEvents.tenantId],
    references: [tenants.id]
  }),
  campaign: one(emailCampaigns, {
    fields: [emailEvents.campaignId],
    references: [emailCampaigns.id]
  }),
  recipient: one(emailCampaignRecipients, {
    fields: [emailEvents.recipientId],
    references: [emailCampaignRecipients.id]
  })
}));

export const emailSuppressionsRelations = relations(emailSuppressions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [emailSuppressions.tenantId],
    references: [tenants.id]
  }),
  subscriber: one(emailSubscribers, {
    fields: [emailSuppressions.subscriberId],
    references: [emailSubscribers.id]
  }),
  campaign: one(emailCampaigns, {
    fields: [emailSuppressions.campaignId],
    references: [emailCampaigns.id]
  })
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [mediaAssets.tenantId],
    references: [tenants.id]
  }),
  uploaderUser: one(users, {
    fields: [mediaAssets.uploaderUserId],
    references: [users.id]
  }),
  links: many(mediaLinks)
}));

export const mediaLinksRelations = relations(mediaLinks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [mediaLinks.tenantId],
    references: [tenants.id]
  }),
  mediaAsset: one(mediaAssets, {
    fields: [mediaLinks.mediaAssetId],
    references: [mediaAssets.id]
  })
}));
