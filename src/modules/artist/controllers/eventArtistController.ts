// src/modules/artist/controllers/eventArtistController.ts
import type { Context } from 'hono';
import { EventArtistAddSchema, EventArtistRemoveSchema } from '../validators/eventArtistValidator.js';
import { eventArtistService } from '../services/eventArtistService.js';
import { artistService } from '../services/artistService.js';
import { db } from '../../../db/client.js';
import { events } from '../../../db/schema/events.js';
import { eq, and } from 'drizzle-orm';

export const addArtistToEvent = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const eventSlug = c.req.param('eventSlug');
  const artistSlug = c.req.param('artistSlug');
  const body = await c.req.json().catch(() => ({}));
  const payload = EventArtistAddSchema.parse({ tenantId, eventSlug, artistSlug, ...body });

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.slug, payload.eventSlug)))
    .limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const artist = await artistService.findBySlug(tenantId, payload.artistSlug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);
  if (artist.verificationStatus !== 'verified') {
    return c.json({ error: 'Artist is pending superadmin verification and cannot be added to an event yet.' }, 403);
  }

  await eventArtistService.addArtist(tenantId, event.id, artist.id, {
    headline: payload.headline,
    displayOrder: payload.displayOrder,
    performanceType: payload.performanceType
  });
  return c.json({ success: true }, 201);
};

export const removeArtistFromEvent = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const eventSlug = c.req.param('eventSlug');
  const artistSlug = c.req.param('artistSlug');
  const payload = EventArtistRemoveSchema.parse({ tenantId, eventSlug, artistSlug });

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.slug, payload.eventSlug)))
    .limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const artist = await artistService.findBySlug(tenantId, payload.artistSlug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  await eventArtistService.removeArtist(tenantId, event.id, artist.id);
  return c.json({ success: true }, 200);
};

export const getArtistsForEvent = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const eventSlug = c.req.param('eventSlug') as string;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.slug, eventSlug)))
    .limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const artistsList = await eventArtistService.getArtistsForEvent(tenantId, event.id);
  return c.json(artistsList);
};

export const getEventsForArtist = async (c: Context) => {
  const tenant = c.get('tenant');
  const tenantId = tenant?.id as string;
  const artistSlug = c.req.param('artistSlug') as string;
  const artist = await artistService.findBySlug(tenantId, artistSlug);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const eventsList = await eventArtistService.getEventsForArtist(tenantId, artist.id);
  return c.json(eventsList);
};
