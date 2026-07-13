/**
 * Curated public events seed.
 *
 * Inserts EXACTLY five hand-written, realistic events (2 Garba + 3 Comedy) that
 * land at the end of June 2026, each with its own venue, distinct banner +
 * thumbnail image, and realistic ticket tiers/pricing. After seeding, every
 * other event in the database is soft-deleted so the public consumer feed shows
 * only these five.
 *
 * Run with:  npm run db:seed
 *
 * Idempotent: re-running upserts the five events (matched by slug) and their
 * ticket types, and re-applies the "only these five are public" rule.
 */
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import { db, sql } from '../client.js';
import { assets } from '../schema/assets.js';
import { categories } from '../schema/categories.js';
import { events } from '../schema/events.js';
import { ticketTypes } from '../schema/ticket-types.js';
import { tenants } from '../schema/tenants.js';
import { tenantMembers } from '../schema/tenant-members.js';
import { users } from '../schema/users.js';
import { venues } from '../schema/venues.js';
import { organizers } from '../../modules/organizer-profiles/schema.js';

const TZ = 'Asia/Kolkata';
const img = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

// IST datetime helper (end of June 2026).
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);

interface SeedTicket {
  name: string;
  price: number;
  totalQuantity: number;
  minPerOrder?: number;
  maxPerOrder?: number;
  description?: string;
  isRefundable?: boolean;
}

interface SeedVenue {
  name: string;
  slug: string;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
  capacity?: number;
}

interface SeedEvent {
  slug: string;
  title: string;
  category: 'garba' | 'comedy';
  shortDescription: string;
  description: string;
  start: string; // IST local "YYYY-MM-DDTHH:mm:ss"
  end: string;
  maxCapacity: number;
  isFeatured: boolean;
  bannerId: string;
  thumbnailId: string;
  cancellationPolicy: string;
  venue: SeedVenue;
  tickets: SeedTicket[];
}

const SEED_EVENTS: SeedEvent[] = [
  // ---------------------------------------------------------------- Garba 1
  {
    slug: 'raas-rang-monsoon-garba-2026',
    title: 'Raas Rang — Monsoon Garba Night',
    category: 'garba',
    shortDescription: 'Live dhol, traditional raas-garba & street food under the monsoon sky.',
    description:
      'Kick off the season early at Raas Rang, Ahmedabad\'s biggest pre-Navratri garba night. ' +
      'Dance to live dhol and folk beats by Aditya Gadhvi and troupe across a 12,000 sq ft floor, ' +
      'with a curated Gujarati street-food bazaar, traditional-wear stalls and a dedicated couples zone. ' +
      'Doors 6:30 PM, garba begins 7:00 PM sharp.',
    start: '2026-06-26T19:00:00',
    end: '2026-06-26T23:30:00',
    maxCapacity: 3200,
    isFeatured: true,
    bannerId: '1514525253161-7a46d19cd819',
    thumbnailId: '1604608672516-f1b9b1d37076',
    cancellationPolicy: 'Full refund up to 72 hours before the event. No refunds thereafter.',
    venue: {
      name: 'Karnavati Club Grounds',
      slug: 'karnavati-club-grounds-ahmedabad',
      addressLine1: 'Karnavati Club, S.G. Highway',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      postalCode: '380015',
      latitude: '23.0204',
      longitude: '72.5074',
      capacity: 3500,
    },
    tickets: [
      { name: 'Stag Entry', price: 399, totalQuantity: 2000, maxPerOrder: 4, description: 'Single entry to the garba floor.' },
      { name: 'Couple Pass', price: 699, totalQuantity: 800, maxPerOrder: 4, description: 'Entry for two to the garba floor.' },
      { name: 'Family Pack (4)', price: 1299, totalQuantity: 300, maxPerOrder: 2, description: 'Entry for four, includes ₹200 food credit.' },
      { name: 'VIP Lounge', price: 1999, totalQuantity: 120, maxPerOrder: 4, description: 'Elevated lounge, valet parking & unlimited refreshments.', isRefundable: true },
    ],
  },

  // ---------------------------------------------------------------- Garba 2
  {
    slug: 'dandiya-dhamaka-surat-2026',
    title: 'Dandiya Dhamaka 2026',
    category: 'garba',
    shortDescription: 'Kirtidan Gadhvi live — Surat\'s grandest dandiya floor.',
    description:
      'Dandiya Dhamaka returns to Surat with folk superstar Kirtidan Gadhvi headlining a four-hour ' +
      'non-stop dandiya marathon. Expect a synchronised LED floor, a 30-piece live band, professional ' +
      'garba instructors for first-timers and a premium hospitality deck. Traditional attire encouraged.',
    start: '2026-06-28T20:00:00',
    end: '2026-06-29T00:30:00',
    maxCapacity: 4200,
    isFeatured: true,
    bannerId: '1601121141461-9d6647bca1ed',
    thumbnailId: '1533174072545-7a4b6ad7a6c3',
    cancellationPolicy: 'Refunds available up to 48 hours before the event, minus a 10% processing fee.',
    venue: {
      name: 'Sabarmati Riverfront Event Ground',
      slug: 'sabarmati-riverfront-event-ground-ahmedabad',
      addressLine1: 'Sabarmati Riverfront, Usmanpura',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      postalCode: '380013',
      latitude: '23.0506',
      longitude: '72.5810',
      capacity: 4500,
    },
    tickets: [
      { name: 'General', price: 499, totalQuantity: 3000, maxPerOrder: 6, description: 'General access to the dandiya floor.' },
      { name: 'Premium Floor', price: 999, totalQuantity: 1000, maxPerOrder: 6, description: 'Front-of-floor access near the stage.' },
      { name: 'VIP Deck', price: 2499, totalQuantity: 200, maxPerOrder: 4, description: 'Hospitality deck with seating, food & valet.', isRefundable: true },
    ],
  },

  // --------------------------------------------------------------- Comedy 1
  {
    slug: 'aakash-gupta-daily-ka-kaam-ahmedabad-2026',
    title: 'Aakash Gupta — Daily Ka Kaam (Live)',
    category: 'comedy',
    shortDescription: 'A brand-new hour of observational stand-up from Aakash Gupta.',
    description:
      'Comicstaan winner Aakash Gupta brings his all-new solo "Daily Ka Kaam" to Ahmedabad — a sharp, ' +
      'relatable hour on family, relationships and the absurd little battles of everyday life. ' +
      '18+. Latecomers may not be admitted once the show begins.',
    start: '2026-06-27T18:30:00',
    end: '2026-06-27T20:30:00',
    maxCapacity: 900,
    isFeatured: false,
    bannerId: '1567942712661-82b9b407abbf',
    thumbnailId: '1585699324551-f6c309eedeca',
    cancellationPolicy: 'Tickets are non-refundable. Event date/time changes will be honoured.',
    venue: {
      name: 'Tagore Hall',
      slug: 'tagore-hall-ahmedabad',
      addressLine1: 'Paldi, Near Sanskar Kendra',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      postalCode: '380007',
      latitude: '23.0103',
      longitude: '72.5631',
      capacity: 950,
    },
    tickets: [
      { name: 'Silver', price: 599, totalQuantity: 400, maxPerOrder: 6, description: 'Rear & balcony seating.' },
      { name: 'Gold', price: 999, totalQuantity: 350, maxPerOrder: 6, description: 'Centre-block seating.' },
      { name: 'Platinum', price: 1499, totalQuantity: 120, maxPerOrder: 4, description: 'Front rows, best view of the stage.' },
      { name: 'Fan Pit + Meet & Greet', price: 2499, totalQuantity: 30, maxPerOrder: 2, description: 'Front pit plus a post-show meet & greet and photo.' },
    ],
  },

  // --------------------------------------------------------------- Comedy 2
  {
    slug: 'zakir-khan-papa-yaar-mumbai-2026',
    title: 'Zakir Khan — Papa Yaar Tour',
    category: 'comedy',
    shortDescription: 'Sakht launda turned softie — Zakir Khan live in Ahmedabad.',
    description:
      'India\'s storytelling stand-up icon Zakir Khan lands in Ahmedabad with "Papa Yaar" — a heartfelt, ' +
      'laugh-out-loud set on fathers, sons and growing up. Expect his signature shayari, crowd work ' +
      'and the warmth that fills arenas. A limited-capacity theatre show — book early.',
    start: '2026-06-29T20:00:00',
    end: '2026-06-29T22:15:00',
    maxCapacity: 2000,
    isFeatured: true,
    bannerId: '1527224538127-2104bb71c51b',
    thumbnailId: '1516450360452-9312f5e86fc7',
    cancellationPolicy: 'No refunds. Tickets are transferable up to 24 hours before the show.',
    venue: {
      name: 'AMA — H.T. Parekh Convention Centre',
      slug: 'ama-ht-parekh-convention-centre-ahmedabad',
      addressLine1: 'ATIRA Campus, IIM Road, Vastrapur',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      postalCode: '380015',
      latitude: '23.0386',
      longitude: '72.5290',
      capacity: 2100,
    },
    tickets: [
      { name: 'General', price: 799, totalQuantity: 900, maxPerOrder: 6, description: 'Upper-tier seating.' },
      { name: 'Silver', price: 1299, totalQuantity: 600, maxPerOrder: 6, description: 'Mid-tier seating.' },
      { name: 'Gold', price: 1999, totalQuantity: 350, maxPerOrder: 4, description: 'Lower-tier, close to the stage.' },
      { name: 'VIP Front Block', price: 3499, totalQuantity: 120, maxPerOrder: 4, description: 'Premium front block with the best sightlines.', isRefundable: true },
    ],
  },

  // --------------------------------------------------------------- Comedy 3
  {
    slug: 'comedy-cinema-night-premiere-ahmedabad-2026',
    title: 'Comedy Cinema Night — Premiere + Live Set',
    category: 'comedy',
    shortDescription: 'A stand-up special premiere on the big screen, followed by a live open set.',
    description:
      'A one-of-a-kind night: catch the exclusive big-screen premiere of a brand-new stand-up special, ' +
      'then stay for a surprise live open-mic set from rising city comics. Recliner seating, gourmet ' +
      'popcorn and a curated comedy line-up — the perfect mid-week laugh. 16+.',
    start: '2026-06-30T19:30:00',
    end: '2026-06-30T22:00:00',
    maxCapacity: 240,
    isFeatured: false,
    bannerId: '1489599849927-2ee91cede3ba',
    thumbnailId: '1485846234645-a62644f84728',
    cancellationPolicy: 'Refundable up to 24 hours before showtime. Seat selection at the venue.',
    venue: {
      name: 'PVR ICON, Acropolis Mall',
      slug: 'pvr-icon-acropolis-ahmedabad',
      addressLine1: 'Acropolis Mall, Thaltej',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      postalCode: '380059',
      latitude: '23.0466',
      longitude: '72.5066',
      capacity: 260,
    },
    tickets: [
      { name: 'Standard', price: 349, totalQuantity: 140, maxPerOrder: 8, description: 'Standard cinema seating.' },
      { name: 'Recliner', price: 599, totalQuantity: 80, maxPerOrder: 6, description: 'Premium recliner seating.' },
      { name: 'Premiere Couch', price: 1199, totalQuantity: 20, maxPerOrder: 4, description: 'Two-seater couch + gourmet popcorn combo.' },
    ],
  },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function main() {
  console.log('Seeding curated public events…');

  // 1) Resolve the tenant + a creator user + (optional) organizer to attach to.
  let organizerId: string | null = null;
  let tenantId: string;

  const [firstOrganizer] = await db
    .select({ id: organizers.id, tenantId: organizers.tenantId })
    .from(organizers)
    .limit(1);

  if (firstOrganizer) {
    organizerId = firstOrganizer.id;
    tenantId = firstOrganizer.tenantId;
  } else {
    const [firstTenant] = await db.select({ id: tenants.id }).from(tenants).limit(1);
    if (!firstTenant) {
      throw new Error('No tenant found in the database — cannot seed events. Run the app once to create a tenant first.');
    }
    tenantId = firstTenant.id;
  }

  // A creator user is required (venues.created_by_user_id is NOT NULL). Prefer a
  // member of the chosen tenant, fall back to any user.
  const [member] = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId))
    .limit(1);
  let creatorUserId = member?.userId ?? null;
  if (!creatorUserId) {
    const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
    creatorUserId = anyUser?.id ?? null;
  }
  if (!creatorUserId) {
    throw new Error('No user found in the database — cannot seed events.');
  }

  console.log(`Using tenant=${tenantId} organizer=${organizerId ?? '(none)'} creator=${creatorUserId}`);

  // 2) Upsert the two categories we need.
  async function upsertCategory(name: string): Promise<string> {
    const slug = slugify(name);
    const [row] = await db
      .insert(categories)
      .values({ tenantId, name, slug, createdByUserId: creatorUserId })
      .onConflictDoUpdate({ target: categories.slug, set: { name, updatedAt: new Date() } })
      .returning({ id: categories.id });
    return row.id;
  }
  const categoryIds: Record<SeedEvent['category'], string> = {
    garba: await upsertCategory('Garba'),
    comedy: await upsertCategory('Comedy'),
  };

  // 3) Upsert an asset by its (unique) key — returns the asset id.
  async function upsertAsset(key: string): Promise<string> {
    const [row] = await db
      .insert(assets)
      .values({ bucket: 'public', key, mimeType: 'image/jpeg', size: 0, uploadedBy: creatorUserId })
      .onConflictDoUpdate({ target: assets.key, set: { updatedAt: new Date() } })
      .returning({ id: assets.id });
    return row.id;
  }

  // 4) Upsert a venue by slug — returns the venue id.
  async function upsertVenue(v: SeedVenue): Promise<string> {
    const [row] = await db
      .insert(venues)
      .values({
        tenantId,
        name: v.name,
        slug: v.slug,
        addressLine1: v.addressLine1,
        city: v.city,
        state: v.state,
        country: v.country,
        postalCode: v.postalCode,
        latitude: v.latitude,
        longitude: v.longitude,
        capacity: v.capacity,
        isActive: true,
        isVerified: true,
        createdByUserId: creatorUserId,
      })
      .onConflictDoUpdate({
        target: venues.slug,
        set: {
          name: v.name,
          addressLine1: v.addressLine1,
          city: v.city,
          state: v.state,
          country: v.country,
          postalCode: v.postalCode,
          latitude: v.latitude,
          longitude: v.longitude,
          capacity: v.capacity,
          updatedAt: new Date(),
        },
      })
      .returning({ id: venues.id });
    return row.id;
  }

  const keepEventIds: string[] = [];

  for (const e of SEED_EVENTS) {
    const venueId = await upsertVenue(e.venue);
    const bannerAssetId = await upsertAsset(img(e.bannerId));
    const thumbnailAssetId = await upsertAsset(img(e.thumbnailId));
    const now = new Date();

    const baseValues = {
      tenantId,
      venueId,
      organizerId,
      categoryId: categoryIds[e.category],
      title: e.title,
      slug: e.slug,
      shortDescription: e.shortDescription,
      description: e.description,
      startDateTime: ist(e.start),
      endDateTime: ist(e.end),
      timezone: TZ,
      bannerAssetId,
      thumbnailAssetId,
      maxCapacity: e.maxCapacity,
      status: 'published' as const,
      visibility: 'public' as const,
      publishedAt: now,
      isFeatured: e.isFeatured,
      cancellationPolicy: e.cancellationPolicy,
      createdByUserId: creatorUserId,
      updatedByUserId: creatorUserId,
      deletedAt: null,
    };

    const [eventRow] = await db
      .insert(events)
      .values(baseValues)
      .onConflictDoUpdate({
        target: events.slug,
        set: {
          venueId,
          organizerId,
          categoryId: categoryIds[e.category],
          title: e.title,
          shortDescription: e.shortDescription,
          description: e.description,
          startDateTime: ist(e.start),
          endDateTime: ist(e.end),
          timezone: TZ,
          bannerAssetId,
          thumbnailAssetId,
          maxCapacity: e.maxCapacity,
          status: 'published',
          visibility: 'public',
          publishedAt: now,
          isFeatured: e.isFeatured,
          cancellationPolicy: e.cancellationPolicy,
          updatedByUserId: creatorUserId,
          deletedAt: null,
          updatedAt: now,
        },
      })
      .returning({ id: events.id });

    const eventId = eventRow.id;
    keepEventIds.push(eventId);

    // Replace ticket types for this event with the curated tiers.
    await db.delete(ticketTypes).where(eq(ticketTypes.eventId, eventId));
    await db.insert(ticketTypes).values(
      e.tickets.map((t) => ({
        tenantId,
        eventId,
        name: t.name,
        slug: slugify(`${e.slug}-${t.name}`),
        description: t.description,
        price: t.price.toFixed(2),
        currency: 'INR',
        totalQuantity: t.totalQuantity,
        soldQuantity: 0,
        reservedQuantity: 0,
        minPerOrder: t.minPerOrder ?? 1,
        maxPerOrder: t.maxPerOrder ?? 10,
        visibility: 'public' as const,
        status: 'active' as const,
        isTransferable: true,
        isRefundable: t.isRefundable ?? false,
        createdByUserId: creatorUserId,
      })),
    );

    console.log(`  ✓ ${e.title}  (${e.tickets.length} ticket tiers)`);
  }

  // 5) Make these the ONLY public events: soft-delete every other live event.
  const archived = await db
    .update(events)
    .set({ deletedAt: new Date(), status: 'archived', updatedAt: new Date() })
    .where(and(isNull(events.deletedAt), notInArray(events.id, keepEventIds)))
    .returning({ id: events.id });

  console.log(`Soft-deleted ${archived.length} other event(s) so only the 5 curated events remain public.`);
  console.log('Done.');
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await sql.end();
    process.exit(1);
  });
