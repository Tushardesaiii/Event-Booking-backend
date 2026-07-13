import { z } from 'zod';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';

const uuidSchema = z.string().uuid();

export const organizerSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(120)
});

export const organizerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const createOrganizerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  displayName: z.string().trim().min(2).max(150).optional().nullable(),
  username: z.string().trim().min(2).max(150).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  logoAssetId: uuidSchema.nullable().optional(),
  bannerAssetId: uuidSchema.nullable().optional(),
  logo: z.string().trim().url().optional().nullable(),
  coverImage: z.string().trim().url().optional().nullable(),
  bio: z.string().trim().max(5000).optional().nullable(),
  website: z.string().trim().url().optional().nullable(),
  instagram: z.string().trim().url().optional().nullable(),
  facebook: z.string().trim().url().optional().nullable(),
  twitterX: z.string().trim().url().optional().nullable(),
  youtube: z.string().trim().url().optional().nullable(),
  supportEmail: z.string().trim().email().optional().nullable(),
  supportPhone: z.string().trim().max(50).optional().nullable(),
  emergencyHelplineNumber: z.string().trim().max(50).optional().nullable(),
  emergencyWhatsappNumber: z.string().trim().max(50).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  socialLinks: z.array(
    z.object({
      platform: z.string().trim().min(1).max(50),
      url: z.string().trim().url()
    })
  ).optional()
});

export const updateOrganizerSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    displayName: z.string().trim().min(2).max(150).optional().nullable(),
    username: z.string().trim().min(2).max(150).optional().nullable(),
    description: z.string().trim().max(5000).nullable().optional(),
    logoAssetId: uuidSchema.nullable().optional(),
    bannerAssetId: uuidSchema.nullable().optional(),
    logo: z.string().trim().url().optional().nullable(),
    coverImage: z.string().trim().url().optional().nullable(),
    bio: z.string().trim().max(5000).optional().nullable(),
    website: z.string().trim().url().optional().nullable(),
    instagram: z.string().trim().url().optional().nullable(),
    facebook: z.string().trim().url().optional().nullable(),
    twitterX: z.string().trim().url().optional().nullable(),
    youtube: z.string().trim().url().optional().nullable(),
    supportEmail: z.string().trim().email().optional().nullable(),
    supportPhone: z.string().trim().max(50).optional().nullable(),
    emergencyHelplineNumber: z.string().trim().max(50).optional().nullable(),
    emergencyWhatsappNumber: z.string().trim().max(50).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    state: z.string().trim().max(100).optional().nullable(),
    country: z.string().trim().max(100).optional().nullable(),
    version: z.number().int().nonnegative().optional().nullable(),
    socialLinks: z.array(
      z.object({
        platform: z.string().trim().min(1).max(50),
        url: z.string().trim().url()
      })
    ).optional()
  })
  .extend(optimisticLockSchema.shape);

export const createOrganizerReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(150).optional().nullable(),
  reviewText: z.string().trim().max(5000).optional().nullable(),
  comment: z.string().trim().max(1000).optional().nullable(),
  visitEventId: uuidSchema.optional().nullable()
});

export const updateOrganizerReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  title: z.string().trim().min(1).max(150).optional().nullable(),
  reviewText: z.string().trim().max(5000).optional().nullable(),
  comment: z.string().trim().max(1000).optional().nullable(),
  visitEventId: uuidSchema.optional().nullable()
});

export const organizerVerificationRequestSchema = z.object({
  reason: z.string().trim().min(5).max(1000).optional().nullable()
});

export const organizerVerificationDecisionSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  reason: z.string().trim().min(5).max(1000)
});

export const organizerSafetyProfileSchema = z.object({
  emergencyHelplineNumber: z.string().trim().max(50).optional().nullable(),
  emergencyWhatsappNumber: z.string().trim().max(50).optional().nullable(),
  medicalHelpDeskInfo: z.string().trim().max(2000).optional().nullable(),
  lostAndFoundDeskInfo: z.string().trim().max(2000).optional().nullable(),
  womenSafetyDeskInfo: z.string().trim().max(2000).optional().nullable(),
  securityDeskInfo: z.string().trim().max(2000).optional().nullable()
});

export const sosReportIssueSchema = z.object({
  eventId: uuidSchema.optional().nullable(),
  organizerId: uuidSchema.optional().nullable(),
  locationName: z.string().trim().max(255).optional().nullable(),
  latitude: z.string().trim().max(50).optional().nullable(),
  longitude: z.string().trim().max(50).optional().nullable(),
  issueCategory: z.enum(['medical', 'harassment', 'security', 'lost', 'crowd', 'emergency', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  details: z.string().trim().max(5000).optional().nullable()
});

export const sosEmergencyAlertSchema = z.object({
  eventId: uuidSchema.optional().nullable(),
  organizerId: uuidSchema.optional().nullable(),
  latitude: z.string().trim().max(50).optional().nullable(),
  longitude: z.string().trim().max(50).optional().nullable(),
  issueCategory: z.enum(['medical', 'harassment', 'security', 'lost', 'crowd', 'emergency', 'other']).default('emergency'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('critical'),
  details: z.string().trim().max(5000).optional().nullable()
});

export const sosStatusUpdateSchema = z.object({
  status: z.enum(['active', 'acknowledged', 'resolved', 'cancelled'])
});

export type OrganizerSlugParamsInput = z.infer<typeof organizerSlugParamsSchema>;
export type OrganizerListQueryInput = z.infer<typeof organizerListQuerySchema>;
export type CreateOrganizerInput = z.infer<typeof createOrganizerSchema>;
export type UpdateOrganizerInput = z.infer<typeof updateOrganizerSchema>;
export type CreateOrganizerReviewInput = z.infer<typeof createOrganizerReviewSchema>;
export type UpdateOrganizerReviewInput = z.infer<typeof updateOrganizerReviewSchema>;
export type OrganizerVerificationRequestInput = z.infer<typeof organizerVerificationRequestSchema>;
export type OrganizerVerificationDecisionInput = z.infer<typeof organizerVerificationDecisionSchema>;
export type OrganizerSafetyProfileInput = z.infer<typeof organizerSafetyProfileSchema>;
export type SosReportIssueInput = z.infer<typeof sosReportIssueSchema>;
export type SosEmergencyAlertInput = z.infer<typeof sosEmergencyAlertSchema>;
