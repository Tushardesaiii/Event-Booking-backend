/**
 * Seed the platform-global artist directory with 10 demo artists (same table
 * and defaults `createDirectoryArtist` uses for a superadmin-created artist:
 * tenant_id = NULL, source = 'platform', verification_status = 'verified')
 * so they show up immediately on the app's Artists rail and search.
 *
 * Profile photos are generated avatar placeholders (ui-avatars.com) — these
 * are fictional personas, not real people, so no real photos are used.
 *
 * Run: npx tsx src/Scripts/seed-demo-artists.ts
 */
import { sql } from '../db/client.js';

interface DemoArtist {
  stageName: string;
  realName?: string;
  bio: string;
  shortBio: string;
  city: string;
  state: string;
  country: string;
  genres: string[];
  languages: string[];
  featured?: boolean;
}

const ARTISTS: DemoArtist[] = [
  {
    stageName: 'Meera Vaghela',
    realName: 'Meera Vaghela',
    bio: 'A Navratri circuit favorite from Ahmedabad, Meera fronts a live garba band known for turning traditional raas melodies into full-stadium singalongs. Ten years of Amdavad pandals later, she still opens every set with a dandiya dhamaka.',
    shortBio: 'Ahmedabad garba vocalist known for stadium-sized Navratri sets.',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'India',
    genres: ['Garba', 'Folk', 'Devotional'],
    languages: ['Gujarati', 'Hindi'],
    featured: true
  },
  {
    stageName: 'Kavan Chauhan',
    realName: 'Kavan Chauhan',
    bio: 'Kavan blends Saurashtra folk instrumentation with modern fusion arrangements — think dhol and harmonium over a live rhythm section. His "Rajkot Roots" tour has become a fixture of the western India garba season.',
    shortBio: 'Rajkot folk-fusion vocalist mixing Saurashtra roots with modern arrangement.',
    city: 'Rajkot',
    state: 'Gujarat',
    country: 'India',
    genres: ['Garba', 'Fusion', 'Indie'],
    languages: ['Gujarati', 'Hindi', 'English']
  },
  {
    stageName: 'Foram Solanki',
    realName: 'Foram Solanki',
    bio: 'Surat-based playback singer who splits her calendar between Bollywood cover sets and devotional garba nights. Known for a vocal range that can carry a raas-garba crowd for four hours straight without losing a beat.',
    shortBio: 'Surat playback singer covering Bollywood and devotional garba.',
    city: 'Surat',
    state: 'Gujarat',
    country: 'India',
    genres: ['Garba', 'Bollywood', 'Devotional'],
    languages: ['Gujarati', 'Hindi']
  },
  {
    stageName: 'DJ Ravan Thakor',
    realName: 'Ravan Thakor',
    bio: 'Vadodara\'s go-to dandiya DJ, Ravan pairs a live dhol player with electronic garba remixes — a set built specifically for late-night raas floors that don\'t want to slow down.',
    shortBio: 'Vadodara DJ pairing live dhol with electronic dandiya remixes.',
    city: 'Vadodara',
    state: 'Gujarat',
    country: 'India',
    genres: ['Dandiya', 'Electronic', 'Folk'],
    languages: ['Gujarati', 'Hindi'],
    featured: true
  },
  {
    stageName: 'Het Rajgor',
    realName: 'Het Rajgor',
    bio: 'A stand-up comedian working almost entirely in Gujarati, Het built his following on hostel-life and Amdavadi-family bits before selling out his first solo show, "Ghar Nu Wifi", across three cities.',
    shortBio: 'Gujarati stand-up comedian, sold-out solo show "Ghar Nu Wifi".',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'India',
    genres: ['Comedy', 'Gujarati Comedy'],
    languages: ['Gujarati', 'Hindi']
  },
  {
    stageName: 'Arjun Mehta',
    realName: 'Arjun Mehta',
    bio: 'Mumbai playback and live-circuit singer with a catalogue of Bollywood covers and original pop singles. A regular headliner on the college-fest and wedding-sangeet circuit.',
    shortBio: 'Mumbai singer covering Bollywood hits and original pop.',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    genres: ['Bollywood', 'Pop'],
    languages: ['Hindi', 'English']
  },
  {
    stageName: 'Naina Kapoor',
    realName: 'Naina Kapoor',
    bio: 'Delhi-based singer-songwriter performing stripped-back acoustic sets built around self-written lyrics. Her independently released EP "Halka Halka" found a following well beyond the city\'s open-mic scene.',
    shortBio: 'Delhi singer-songwriter, acoustic indie-pop sets.',
    city: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    genres: ['Indie', 'Pop', 'Acoustic'],
    languages: ['Hindi', 'English']
  },
  {
    stageName: 'DJ Kabir Rao',
    realName: 'Kabir Rao',
    bio: 'A fixture of Bangalore\'s festival-stage circuit, Kabir plays progressive house and big-room EDM sets built for outdoor main stages and late-night club floors alike.',
    shortBio: 'Bangalore festival DJ — progressive house and EDM.',
    city: 'Bangalore',
    state: 'Karnataka',
    country: 'India',
    genres: ['EDM', 'House', 'Progressive'],
    languages: ['English', 'Hindi'],
    featured: true
  },
  {
    stageName: 'The Sunset Collective',
    bio: 'A five-piece indie rock band out of Pune, The Sunset Collective built their name on a self-released debut album and a live show heavy on guitar hooks and audience singalongs.',
    shortBio: 'Pune indie rock five-piece, guitar-driven live shows.',
    city: 'Pune',
    state: 'Maharashtra',
    country: 'India',
    genres: ['Rock', 'Indie'],
    languages: ['English', 'Hindi']
  },
  {
    stageName: 'Ritika Bansal',
    realName: 'Ritika Bansal',
    bio: 'Mumbai stand-up comedian working in Hindi and English, Ritika\'s observational sets on office life and dating in your late twenties have made her a regular at the city\'s top comedy clubs.',
    shortBio: 'Mumbai stand-up comedian — observational Hindi/English sets.',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    genres: ['Comedy'],
    languages: ['Hindi', 'English']
  }
];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 200) || 'artist'
  );
}

async function uniqueSlug(desired: string): Promise<string> {
  const base = slugify(desired);
  let slug = base;
  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await sql.unsafe(
      `SELECT id FROM artists WHERE lower(slug) = $1 AND deleted_at IS NULL LIMIT 1`,
      [slug]
    );
    if (existing.length === 0) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

function avatarUrl(name: string, background: string): string {
  const encoded = encodeURIComponent(name);
  return `https://ui-avatars.com/api/?name=${encoded}&background=${background}&color=fff&size=512&bold=true&format=png`;
}

const PALETTE = ['B91C1C', 'B45309', '15803D', '0E7490', '1D4ED8', '6D28D9', 'BE185D', '4D7C0F', 'C2410C', '0891B2'];

async function main() {
  console.log(`▶ Seeding ${ARTISTS.length} demo artists into the platform directory...`);

  const created: string[] = [];
  for (let i = 0; i < ARTISTS.length; i++) {
    const a = ARTISTS[i];
    const slug = await uniqueSlug(a.stageName);
    const profileImageUrl = avatarUrl(a.stageName, PALETTE[i % PALETTE.length]);

    await sql.unsafe(
      `INSERT INTO artists (
        tenant_id, created_by_user_id, source, slug, stage_name, real_name, bio, short_bio,
        profile_image_url, city, state, country, genres, languages,
        verified, verification_status, featured, active, version, created_at, updated_at
      ) VALUES (
        NULL, NULL, 'platform', $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10::jsonb, $11::jsonb,
        true, 'verified', $12, true, 0, now(), now()
      )`,
      [
        slug,
        a.stageName,
        a.realName ?? null,
        a.bio,
        a.shortBio,
        profileImageUrl,
        a.city,
        a.state,
        a.country,
        JSON.stringify(a.genres),
        JSON.stringify(a.languages),
        a.featured ?? false
      ]
    );
    created.push(`${a.stageName} (${slug})`);
    console.log(`  ✓ ${a.stageName} → /${slug}`);
  }

  console.log(`✅ Created ${created.length} artists.`);
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
