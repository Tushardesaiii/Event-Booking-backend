// src/modules/artist/validators/eventArtistValidator.ts
import { z } from 'zod';

export const EventArtistAddSchema = z.object({
  tenantId: z.string().uuid(),
  eventSlug: z.string().min(1).max(255),
  artistSlug: z.string().min(1).max(255),
  headline: z.boolean().optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  performanceType: z.enum(['Main Performer', 'Guest', 'Host', 'DJ', 'Speaker', 'Comedian']).optional()
});

export const EventArtistRemoveSchema = z.object({
  tenantId: z.string().uuid(),
  eventSlug: z.string().min(1).max(255),
  artistSlug: z.string().min(1).max(255)
});
