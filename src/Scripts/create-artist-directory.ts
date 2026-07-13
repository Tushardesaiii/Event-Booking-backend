/**
 * Promote the `artists` table to a PLATFORM-GLOBAL directory (idempotent, additive).
 *
 * Before: every artist belonged to exactly one tenant (tenant_id NOT NULL, slug
 * unique only within a tenant). After: artists are shared across the whole
 * platform — superadmin-owned rows have tenant_id = NULL, organizer-contributed
 * rows keep the creating tenant for provenance, and slugs are globally unique so
 * any organizer can find and reuse any artist.
 *
 * Run: `npm run create:artist-directory`
 */
import { sql } from '../db/client.js';

async function main() {
  console.log('▶ Promoting artists to a platform-global directory…');

  // 1) Superadmin-owned artists have no tenant.
  await sql`ALTER TABLE artists ALTER COLUMN tenant_id DROP NOT NULL`;

  // 2) Provenance: who added the artist, and via which surface.
  await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id)`;
  await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'platform'`;

  // 3) Global slug uniqueness (case-insensitive, ignoring soft-deleted rows) so
  //    the directory has one canonical entry per artist regardless of tenant.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS artists_global_slug_unique_idx
    ON artists (lower(slug)) WHERE deleted_at IS NULL
  `;

  // 4) Fast typeahead search on stage name.
  await sql`CREATE INDEX IF NOT EXISTS artists_stage_name_idx ON artists (lower(stage_name))`;

  console.log('✅ Artist directory schema ready.');
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
