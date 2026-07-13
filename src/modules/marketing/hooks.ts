import { db } from '../../db/client.js';
import { insertVerificationEvent } from '../notifications/repository.js';
import { marketingSubscriberService } from './service.js';
import { logger } from '../../lib/logger.js';

export const marketingHooks = {
  async onUserRegistered(
    user: { id: string; email: string; fullName?: string; marketingOptIn?: boolean },
    context: { tenantId?: string | null }
  ) {
    logger.info('marketing hook: onUserRegistered triggered', {
      userId: user.id,
      email: user.email,
      tenantId: context.tenantId
    });

    await insertVerificationEvent(db, {
      actorUserId: user.id,
      tenantId: context.tenantId ?? null,
      eventType: 'user_registered_hook',
      source: 'marketing',
      email: user.email,
      metadata: { marketingOptIn: user.marketingOptIn }
    });

    if (user.marketingOptIn) {
      try {
        const names = user.fullName ? user.fullName.split(' ') : [];
        const firstName = names[0] || '';
        const lastName = names.slice(1).join(' ') || '';
        await marketingSubscriberService.subscribe(
          {
            email: user.email,
            firstName,
            lastName,
            source: 'user_registration',
            metadata: { userId: user.id }
          },
          context.tenantId
        );
      } catch (err: any) {
        logger.error('failed to auto-subscribe user during registration hook', {
          error: err.message,
          userId: user.id
        });
      }
    }
  },

  async onUserLogin(user: { id: string; email: string }, context: { tenantId?: string | null }) {
    logger.info('marketing hook: onUserLogin triggered', {
      userId: user.id,
      email: user.email,
      tenantId: context.tenantId
    });

    await insertVerificationEvent(db, {
      actorUserId: user.id,
      tenantId: context.tenantId ?? null,
      eventType: 'user_login_hook',
      source: 'marketing',
      email: user.email
    });
  },

  async onEmailVerified(user: { id: string; email: string }, context: { tenantId?: string | null }) {
    logger.info('marketing hook: onEmailVerified triggered', {
      userId: user.id,
      email: user.email,
      tenantId: context.tenantId
    });

    await insertVerificationEvent(db, {
      actorUserId: user.id,
      tenantId: context.tenantId ?? null,
      eventType: 'email_verified_hook',
      source: 'marketing',
      email: user.email
    });
  },

  async onOtpVerified(user: { id: string; phoneNumber: string }, context: { tenantId?: string | null }) {
    logger.info('marketing hook: onOtpVerified triggered', {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      tenantId: context.tenantId
    });

    await insertVerificationEvent(db, {
      actorUserId: user.id,
      tenantId: context.tenantId ?? null,
      eventType: 'otp_verified_hook',
      source: 'marketing',
      phoneNumber: user.phoneNumber
    });
  },

  async onEventPublished(event: { id: string; name: string }, context: { tenantId?: string | null }) {
    logger.info('marketing hook: onEventPublished triggered', {
      eventId: event.id,
      eventName: event.name,
      tenantId: context.tenantId
    });

    await insertVerificationEvent(db, {
      tenantId: context.tenantId ?? null,
      eventType: 'event_published_hook',
      source: 'marketing',
      metadata: { eventId: event.id, eventName: event.name }
    });
  },

  async onBookingConfirmed(
    booking: { id: string; orderNumber: string; userEmail: string; userId?: string },
    context: { tenantId?: string | null }
  ) {
    logger.info('marketing hook: onBookingConfirmed triggered', {
      bookingId: booking.id,
      orderNumber: booking.orderNumber,
      tenantId: context.tenantId
    });

    await insertVerificationEvent(db, {
      actorUserId: booking.userId ?? null,
      tenantId: context.tenantId ?? null,
      eventType: 'booking_confirmed_hook',
      source: 'marketing',
      email: booking.userEmail,
      metadata: { bookingId: booking.id, orderNumber: booking.orderNumber }
    });
  },

  async onTicketIssued(
    ticket: { id: string; ticketNumber: string; attendeeEmail: string; attendeeName?: string },
    context: { tenantId?: string | null }
  ) {
    logger.info('marketing hook: onTicketIssued triggered', {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      tenantId: context.tenantId
    });

    await insertVerificationEvent(db, {
      tenantId: context.tenantId ?? null,
      eventType: 'ticket_issued_hook',
      source: 'marketing',
      email: ticket.attendeeEmail,
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber }
    });
  }
};
