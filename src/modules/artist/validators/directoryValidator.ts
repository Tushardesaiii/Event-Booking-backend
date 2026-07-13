import { z } from 'zod';

// URLs/handles are kept lenient (plain strings) so organizers can paste either a
// full URL or a bare handle without the form rejecting them; the apps just render
// what's stored. Length caps match the DB columns.
const shortText = (max: number) => z.string().trim().max(max).nullable().optional();
const imageField = z.string().min(16).nullable().optional();

export const directoryArtistCreateSchema = z.object({
  stageName: z.string().trim().min(1).max(255),
  slug: z.string().trim().max(255).optional(),
  realName: shortText(255),
  bio: shortText(5000),
  shortBio: shortText(500),
  city: shortText(255),
  state: shortText(255),
  country: shortText(255),
  genres: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  languages: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  instagramUrl: shortText(512),
  youtubeUrl: shortText(512),
  spotifyUrl: shortText(512),
  websiteUrl: shortText(512),
  bookingEmail: shortText(255),
  managementContact: shortText(255),
  verified: z.boolean().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  imageBase64: imageField,
  coverBase64: imageField,
});

export const directoryArtistUpdateSchema = directoryArtistCreateSchema.partial();

export const directorySearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().positive().max(25).optional(),
});

// "true"/"false"/"1"/"0" → boolean (z.coerce.boolean treats any non-empty string
// as true, which would make ?verified=false mean true — so parse explicitly).
const booleanish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === '1';
  });

export const directoryListSchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  verified: booleanish,
  featured: booleanish,
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
});

// Superadmin verification decision for a directory artist.
export const artistVerificationSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']),
});

export const publicArtistListSchema = z.object({
  limit: z.coerce.number().int().positive().max(60).optional(),
});

export type DirectoryArtistCreate = z.infer<typeof directoryArtistCreateSchema>;
export type DirectoryArtistUpdate = z.infer<typeof directoryArtistUpdateSchema>;
