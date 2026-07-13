import { z } from 'zod';

// Templates
export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  subject: z.string().trim().min(1, 'Subject is required'),
  htmlContent: z.string().trim().min(1, 'HTML Content is required'),
  textContent: z.string().trim().optional()
});

export const updateTemplateSchema = createTemplateSchema.partial();

// Subscribers
export const subscribeSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  status: z.enum(['subscribed', 'unsubscribed', 'suppressed', 'bounced']).default('subscribed')
});

export const importCsvSchema = z.object({
  subscribers: z.array(
    z.object({
      email: z.string().trim().email('Invalid email address'),
      firstName: z.string().trim().optional().nullable(),
      lastName: z.string().trim().optional().nullable()
    })
  ).min(1, 'At least one subscriber is required')
});

// Segment Filters Schema
export const segmentFiltersSchema = z.object({
  type: z.enum([
    'all_subscribers',
    'event_attendees',
    'previous_attendees',
    'custom_uploads',
    'event_category',
    'event_tags',
    'location',
    'specific_events'
  ]),
  categoryId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  eventIds: z.array(z.string().uuid()).optional(),
  attendedOnly: z.boolean().optional()
});

// Segments
export const createSegmentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().optional(),
  filters: segmentFiltersSchema
});

export const updateSegmentSchema = createSegmentSchema.partial();

// Campaigns
export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  subject: z.string().trim().min(1, 'Subject is required'),
  templateId: z.string().uuid('Invalid template ID').optional().nullable(),
  segmentId: z.string().uuid('Invalid segment ID').optional().nullable(),
  audienceFiltersJson: segmentFiltersSchema.optional().nullable()
});

export const updateCampaignSchema = createCampaignSchema.partial();

export const scheduleCampaignSchema = z.object({
  scheduledAt: z.string().datetime({ message: 'Must be a valid ISO 8601 datetime string' })
});
