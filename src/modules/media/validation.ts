import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const ALLOWED_ENTITY_TYPES = [
  'event',
  'artist',
  'organizer',
  'profile',
  'story',
  'ticket_type',
  'group_booking',
  'marketing_campaign',
  'review',
  'sos_report',
  'verification_request'
] as const;

export const ALLOWED_ROLES = [
  'hero',
  'thumbnail',
  'gallery',
  'poster',
  'promo_video',
  'avatar',
  'cover',
  'story',
  'story_image',
  'story_video',
  'banner',
  'artwork',
  'review_photo',
  'review_video',
  'sos_evidence',
  'sos_video',
  'sos_attachment',
  'sos_document',
  'verification_document',
  'chat_attachment'
] as const;

export const uploadUrlRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().refine(
    (mime) =>
      mime.startsWith('image/') ||
      mime.startsWith('video/') ||
      mime === 'application/pdf' ||
      mime.startsWith('application/msword') ||
      mime.startsWith('application/vnd.openxml') ||
      mime === 'text/plain',
    { message: 'MIME type must be an image, video, or document format' }
  ),
  fileSize: z.number().int().positive().max(
    50 * 1024 * 1024,
    { message: 'File size must not exceed 50 MB' }
  ),
  entityType: z.enum(ALLOWED_ENTITY_TYPES),
  role: z.enum(ALLOWED_ROLES),
  expiresInSeconds: z.number().int().positive().min(10).max(604800).optional().default(3600)
});

// Server-side base64 upload (browser → backend → R2), avoiding a direct
// browser→R2 presigned PUT (which needs R2 CORS). Used by the dashboard gallery.
export const uploadDirectRequestSchema = z.object({
  image: z.string().min(1, 'image is required'),
  entityType: z.enum(ALLOWED_ENTITY_TYPES),
  entityId: uuidSchema.optional(),
  role: z.enum(ALLOWED_ROLES),
  fileName: z.string().max(255).optional()
});

export const completeUploadRequestSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().refine(
    (mime) =>
      mime.startsWith('image/') ||
      mime.startsWith('video/') ||
      mime === 'application/pdf' ||
      mime.startsWith('application/msword') ||
      mime.startsWith('application/vnd.openxml') ||
      mime === 'text/plain',
    { message: 'MIME type must be an image, video, or document format' }
  ),
  fileSize: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  checksum: z.string().min(1).optional()
});

export const createMediaLinkRequestSchema = z.object({
  mediaAssetId: uuidSchema,
  entityType: z.enum(ALLOWED_ENTITY_TYPES),
  entityId: uuidSchema,
  role: z.enum(ALLOWED_ROLES),
  displayOrder: z.number().int().nonnegative().optional().default(0)
});

export const removeMediaLinkRequestSchema = z.object({
  mediaAssetId: uuidSchema,
  entityType: z.enum(ALLOWED_ENTITY_TYPES),
  entityId: uuidSchema,
  role: z.enum(ALLOWED_ROLES)
});

export const entityParamsSchema = z.object({
  type: z.enum(ALLOWED_ENTITY_TYPES),
  id: uuidSchema
});

export const mediaIdParamsSchema = z.object({
  id: uuidSchema
});

export const moderationRequestSchema = z.object({
  mediaAssetId: uuidSchema,
  status: z.enum(['approved', 'rejected', 'flagged', 'under_review']),
  reason: z.string().max(500).optional()
});

export const updateQuotaRequestSchema = z.object({
  userId: uuidSchema.optional(),
  maxStorageBytes: z.coerce.number().int().positive()
});
