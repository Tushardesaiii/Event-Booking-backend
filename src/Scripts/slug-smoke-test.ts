import { createSlug, createUniqueSlug, createSlugSuffix } from '../lib/slug.js';
import { insertWithSlugRetry } from '../lib/slug-write.js';

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function expectSlugFormat(value: string, label: string) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*-[23456789abcdefghjkmnpqrstuvwxyz]{5}$/.test(value), `${label} has an invalid slug format`, value);
}

async function run() {
  console.log('SLUG SMOKE TEST START');

  assert(createSlug('Royal Garba Night 2026') === 'royal-garba-night-2026', 'base slug normalization failed');
  assert(createSlug('') === 'item', 'empty slug fallback failed');

  const suffix = createSlugSuffix();
  assert(/^[23456789abcdefghjkmnpqrstuvwxyz]{5}$/.test(suffix), 'slug suffix format failed', suffix);

  const sample = Array.from({ length: 100 }, () => createUniqueSlug('Royal Garba Night'));
  sample.forEach((slug, index) => expectSlugFormat(slug, `sample slug ${index + 1}`));
  assert(new Set(sample).size === sample.length, 'sample slugs should be unique', sample);

  let attempts = 0;
  const retried = await insertWithSlugRetry(
    async (slug) => {
      attempts += 1;

      if (attempts === 1) {
        const error = new Error('duplicate');
        (error as { code?: string }).code = '23505';
        throw error;
      }

      return slug;
    },
    () => createUniqueSlug('Royal Garba Night')
  );

  assert(retried !== null, 'retried slug should not be null');
  expectSlugFormat(retried, 'retried slug');
  assert(attempts === 2, 'collision retry should run exactly once', attempts);

  console.log('SLUG SMOKE TEST PASSED');
}

run().catch((error) => {
  console.error('SLUG SMOKE TEST FAILED');
  console.error(error);
  process.exit(1);
});

export {};