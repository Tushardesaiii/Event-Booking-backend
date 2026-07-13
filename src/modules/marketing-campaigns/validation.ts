import { z } from 'zod';

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(200),
  subject: z.string().trim().min(2).max(200),
  templateType: z.string().trim().min(1),
  metadata: z.record(z.string(), z.any()).optional().nullable()
});

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  subject: z.string().trim().min(2).max(200).optional(),
  templateType: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.any()).optional().nullable()
});

export const scheduleCampaignSchema = z.object({
  scheduledAt: z.string().datetime()
});

export const listCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional().nullable()
});

export const previewCampaignSchema = z.object({
  email: z.string().email()
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>;
export type ListCampaignsQueryInput = z.infer<typeof listCampaignsQuerySchema>;
export type PreviewCampaignInput = z.infer<typeof previewCampaignSchema>;
