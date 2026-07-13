import { randomBytes } from 'node:crypto';

const SLUG_SUFFIX_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function slugify(input: string) {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'item';
}

export function createSlug(input: string) {
  return slugify(input);
}

export function createSlugSuffix(length = 5) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => SLUG_SUFFIX_ALPHABET[byte % SLUG_SUFFIX_ALPHABET.length]).join('');
}

export function createUniqueSlug(input: string) {
  return `${slugify(input)}-${createSlugSuffix()}`;
}
