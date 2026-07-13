import type { Context } from 'hono';
import { mediaService } from './service.js';
import {
  uploadUrlRequestSchema,
  uploadDirectRequestSchema,
  completeUploadRequestSchema,
  createMediaLinkRequestSchema,
  removeMediaLinkRequestSchema,
  entityParamsSchema,
  moderationRequestSchema,
  updateQuotaRequestSchema
} from './validation.js';
import { optimisticLockSchema } from '../../lib/optimistic-locking.js';
import { forbidden } from '../../lib/errors.js';
import type { AppEnv } from '../../types/context.js';

function getContext(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const tenantMembership = c.get('tenantMembership');

  if (!tenant) {
    throw forbidden('Tenant context is required');
  }
  if (!user) {
    throw forbidden('User authentication is required');
  }

  return { tenant, user, tenantMembership };
}

export const mediaController = {
  async getSignedUploadUrl(c: Context<AppEnv>) {
    const { tenant, user } = getContext(c);
    const body = await c.req.json().catch(() => ({}));
    const payload = uploadUrlRequestSchema.parse(body);

    const uploadInfo = await mediaService.generateUploadUrl(tenant.id, user.id, payload);
    return c.json(uploadInfo);
  },

  async completeUpload(c: Context<AppEnv>) {
    const { tenant, user } = getContext(c);
    const body = await c.req.json().catch(() => ({}));
    const payload = completeUploadRequestSchema.parse(body);

    const asset = await mediaService.completeUpload(tenant.id, user.id, payload);
    return c.json(asset, 201);
  },

  async uploadDirect(c: Context<AppEnv>) {
    const { tenant, user } = getContext(c);
    const body = await c.req.json().catch(() => ({}));
    const payload = uploadDirectRequestSchema.parse(body);

    const asset = await mediaService.uploadDirect(tenant.id, user.id, payload);
    return c.json(asset, 201);
  },

  async getMediaAsset(c: Context<AppEnv>) {
    const { tenant } = getContext(c);
    const id = c.req.param('id') as string;

    const asset = await mediaService.getMediaAsset(tenant.id, id);
    return c.json(asset);
  },

  async deleteMediaAsset(c: Context<AppEnv>) {
    const { tenant, user, tenantMembership } = getContext(c);
    const id = c.req.param('id') as string;
    const body = await c.req.json().catch(() => ({}));
    const { lastKnownUpdatedAt } = optimisticLockSchema.parse(body);

    // Fetch asset to verify ownership
    const asset = await mediaService.getMediaAsset(tenant.id, id);

    // RBAC check: only uploader, current owner, OR tenant manager/admin/owner can delete
    const isOwner = tenantMembership && ['owner', 'admin', 'manager'].includes(tenantMembership.role);
    const isUploader = asset.uploaderUserId === user.id || asset.originalUploaderId === user.id || asset.currentOwnerId === user.id;

    if (!isUploader && !isOwner) {
      throw forbidden('You do not have permission to delete this media asset');
    }

    const updated = await mediaService.deleteMediaAsset(tenant.id, user.id, id, lastKnownUpdatedAt);
    return c.json(updated);
  },

  async linkMediaAsset(c: Context<AppEnv>) {
    const { tenant, user } = getContext(c);
    const body = await c.req.json().catch(() => ({}));
    const payload = createMediaLinkRequestSchema.parse(body);

    const link = await mediaService.linkMediaAsset(tenant.id, user.id, payload);
    return c.json(link, 201);
  },

  async unlinkMediaAsset(c: Context<AppEnv>) {
    const { tenant, user, tenantMembership } = getContext(c);
    const body = await c.req.json().catch(() => ({}));
    const payload = removeMediaLinkRequestSchema.parse(body);

    // RBAC: uploader, owner, or tenant manager/admin/owner
    const asset = await mediaService.getMediaAsset(tenant.id, payload.mediaAssetId);
    const isOwner = tenantMembership && ['owner', 'admin', 'manager'].includes(tenantMembership.role);
    const isUploader = asset.uploaderUserId === user.id || asset.originalUploaderId === user.id || asset.currentOwnerId === user.id;

    if (!isUploader && !isOwner) {
      throw forbidden('You do not have permission to unlink this media asset');
    }

    const result = await mediaService.unlinkMediaAsset(tenant.id, user.id, payload);
    return c.json(result);
  },

  async getEntityMedia(c: Context<AppEnv>) {
    const { tenant } = getContext(c);
    const type = c.req.param('type');
    const id = c.req.param('id');

    const params = entityParamsSchema.parse({ type, id });

    const mediaList = await mediaService.listMediaForEntity(tenant.id, params.type, params.id);
    return c.json(mediaList);
  },

  async getEntityGallery(c: Context<AppEnv>) {
    const { tenant } = getContext(c);
    const type = c.req.param('type');
    const id = c.req.param('id');

    const params = entityParamsSchema.parse({ type, id });

    const galleryList = await mediaService.listGalleryForEntity(tenant.id, params.type, params.id);
    return c.json(galleryList);
  },

  async getAnalytics(c: Context<AppEnv>) {
    const { tenant } = getContext(c);
    const stats = await mediaService.getMediaAnalytics(tenant.id);
    return c.json(stats);
  },

  // Moderation, Quotas, Advanced Analytics
  async getAdvancedAnalytics(c: Context<AppEnv>) {
    const { tenant, tenantMembership } = getContext(c);
    const isOwner = tenantMembership && ['owner', 'admin', 'manager'].includes(tenantMembership.role);
    if (!isOwner) {
      throw forbidden('Insufficient permissions to view advanced analytics');
    }
    const stats = await mediaService.getAdvancedMediaAnalytics(tenant.id);
    return c.json(stats);
  },

  async getQuota(c: Context<AppEnv>) {
    const { tenant, user } = getContext(c);
    const quota = await mediaService.getQuotaUsage(tenant.id, user.id);
    return c.json(quota);
  },

  async updateQuota(c: Context<AppEnv>) {
    const { tenant, tenantMembership } = getContext(c);
    const isOwner = tenantMembership && ['owner', 'admin', 'manager'].includes(tenantMembership.role);
    if (!isOwner) {
      throw forbidden('Insufficient permissions to configure quotas');
    }
    const body = await c.req.json().catch(() => ({}));
    const payload = updateQuotaRequestSchema.parse(body);

    const quota = await mediaService.updateQuotaLimit(tenant.id, payload);
    return c.json({ success: true, quota });
  },

  async moderateAsset(c: Context<AppEnv>) {
    const { tenant, user, tenantMembership } = getContext(c);
    const isOwner = tenantMembership && ['owner', 'admin', 'manager'].includes(tenantMembership.role);
    if (!isOwner) {
      throw forbidden('Insufficient permissions to perform moderation');
    }
    const body = await c.req.json().catch(() => ({}));
    const payload = moderationRequestSchema.parse(body);

    const result = await mediaService.moderateAsset(tenant.id, user.id, payload);
    return c.json(result);
  }
};
