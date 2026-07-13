// src/modules/artist/validators/artistCreateValidator.ts
import { z } from 'zod';

export const ArtistCreateSchema = z.object({
  tenantId: z.string().uuid(),
  slug: z.string().min(1).max(255),
  stageName: z.string().min(1).max(255),
  realName: z.string().max(255).optional(),
  bio: z.string().optional(),
  shortBio: z.string().optional(),
  profileImageUrl: z.string().url().optional(),
  coverImageUrl: z.string().url().optional(),
  city: z.string().max(255).optional(),
  state: z.string().max(255).optional(),
  country: z.string().max(255).optional(),
  languages: z.array(z.string()).optional(),
  instagramUrl: z.string().url().optional(),
  youtubeUrl: z.string().url().optional(),
  spotifyUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  bookingEmail: z.string().email().optional(),
  managementContact: z.string().max(255).optional(),
  verified: z.boolean().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  genres: z.array(z.string()).optional()
});
