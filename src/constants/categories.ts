// Canonical event-interest taxonomy for the whole platform: the mobile app's
// onboarding "Interest DNA" picker, its home-feed category tabs, its profile
// interest editor, and the organizer dashboard's event-category picker
// (served to both via GET /public/categories) all draw from this one list —
// so a category picked in the dashboard always matches an interest a
// consumer can select. Mirrored (by id/label) in
// revelis-app/revelis-app/src/constants/interests.ts, since onboarding needs
// this list instantly and offline before any network call resolves — keep
// the two in sync when adding/renaming entries.
export interface EventCategory {
  id: string;
  label: string;
  /** Keywords matched (case/punctuation-insensitive substring) against free-form
   *  category/title text for interest-based search relevance and match scoring. */
  aliases: string[];
}

export const EVENT_CATEGORIES: EventCategory[] = [
  { id: 'concerts', label: 'Concerts', aliases: ['concert', 'music', 'live', 'gig', 'band', 'dj'] },
  { id: 'garba', label: 'Garba', aliases: ['garba', 'raas', 'navratri', 'dandiya'] },
  { id: 'navratri', label: 'Navratri', aliases: ['navratri', 'navratra', 'garba', 'raas'] },
  { id: 'dandiya', label: 'Dandiya', aliases: ['dandiya', 'dandiya raas', 'raas'] },
  { id: 'comedy', label: 'Comedy', aliases: ['comedy', 'standup', 'stand up', 'humor'] },
  { id: 'movies', label: 'Movies', aliases: ['movie', 'film', 'cinema', 'screening'] },
  { id: 'sports', label: 'Sports', aliases: ['sport', 'match', 'tournament', 'cricket', 'football'] },
  { id: 'nightlife', label: 'Nightlife', aliases: ['nightlife', 'party', 'club', 'rave'] },
  { id: 'theatre', label: 'Theatre', aliases: ['theatre', 'theater', 'play', 'drama'] },
  { id: 'food', label: 'Food Events', aliases: ['food', 'culinary', 'dining', 'cuisine'] },
  { id: 'art', label: 'Art & Culture', aliases: ['art', 'culture', 'exhibition', 'gallery'] },
  { id: 'gaming', label: 'Gaming', aliases: ['gaming', 'game', 'esport'] },
  { id: 'wellness', label: 'Wellness', aliases: ['wellness', 'yoga', 'meditation', 'fitness'] },
  { id: 'openmic', label: 'Open Mic', aliases: ['open mic', 'openmic', 'poetry', 'slam'] },
  { id: 'workshops', label: 'Workshops', aliases: ['workshop', 'masterclass', 'bootcamp', 'training'] },
  { id: 'fashion', label: 'Fashion', aliases: ['fashion', 'runway', 'style', 'apparel'] },
  { id: 'kidsfamily', label: 'Kids & Family', aliases: ['kids', 'family', 'children'] },
  { id: 'networking', label: 'Networking', aliases: ['networking', 'meetup', 'mixer', 'conference'] },
];

export const INTEREST_ALIASES: Record<string, string[]> = Object.fromEntries(
  EVENT_CATEGORIES.map((c) => [c.id, c.aliases]),
);
