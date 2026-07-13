// src/modules/profile/validators/profileValidator.ts
import { z } from 'zod';

const reservedUsernames = ['admin', 'support', 'help', 'system', 'root', 'security', 'api', 'vibe', 'official'];

export const usernameSchema = z.string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9-_]+$/, 'Username must be lowercase alphanumeric and can only contain hyphens and underscores')
  .refine((val) => !reservedUsernames.includes(val), {
    message: 'Username is reserved and cannot be used'
  });

export const ProfileCreateSchema = z.object({
  username: usernameSchema,
  displayName: z.string().min(1).max(255),
  avatarUrl: z.string().url().optional().nullable(),
  coverImageUrl: z.string().url().optional().nullable(),
  bio: z.string().max(1000).optional().nullable(),
  city: z.string().max(255).optional().nullable(),
  state: z.string().max(255).optional().nullable(),
  country: z.string().max(255).optional().nullable(),
  gender: z.string().max(50).optional().nullable(),
  dateOfBirth: z.string().datetime().or(z.date()).optional().nullable(),
  phoneVisibility: z.boolean().optional().default(false),
  emailVisibility: z.boolean().optional().default(false),
  profileVisibility: z.enum(['public', 'followers_only', 'private']).optional().default('public')
});

export const ProfileUpdateSchema = ProfileCreateSchema.partial().extend({
  version: z.number().optional()
});

export const PreferencesUpdateSchema = z.object({
  preferredCities: z.array(z.string()).optional(),
  preferredCategories: z.array(z.string()).optional(),
  preferredArtists: z.array(z.string().uuid()).optional(),
  preferredPriceRangeMin: z.string().or(z.number()).optional().nullable(),
  preferredPriceRangeMax: z.string().or(z.number()).optional().nullable(),
  preferredEventTypes: z.array(z.string()).optional(),
  preferredLanguages: z.array(z.string()).optional(),
  discoveryRadiusKm: z.number().int().min(1).max(500).optional(),
  notificationPreferences: z.record(z.string(), z.any()).optional()
});

export const TrustedContactSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().min(1).max(100),
  relationship: z.string().min(1).max(100),
  isPrimary: z.boolean().optional().default(false)
});

export const BuddyPreferencesSchema = z.object({
  enabled: z.boolean(),
  bio: z.string().max(1000).optional().nullable(),
  ageRangeMin: z.number().int().min(18).max(100).optional().default(18),
  ageRangeMax: z.number().int().min(18).max(100).optional().default(99),
  genderPreference: z.string().max(50).optional().default('any'),
  preferredCategories: z.array(z.string()).optional(),
  preferredCities: z.array(z.string()).optional()
});

export const ReviewSchema = z.object({
  targetType: z.enum(['event', 'artist', 'organizer']),
  targetId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  reviewText: z.string().max(2000).optional().nullable()
});

export const VerificationRequestSchema = z.object({
  verificationType: z.enum(['identity', 'frequent_attendee', 'contributor'])
});
