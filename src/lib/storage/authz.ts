export function canReadAsset(
  asset: { visibility: string; tenantId: string | null; ownerId: string | null; uploadedBy: string | null },
  tenantId: string | null,
  userId: string | null,
  userRole?: string
): boolean {
  if (asset.visibility === 'public') {
    return true;
  }
  
  if (userRole === 'admin' || userRole === 'owner') {
    return true;
  }

  if (asset.visibility === 'private') {
    return userId !== null && (asset.ownerId === userId || asset.uploadedBy === userId);
  }

  if (asset.visibility === 'tenant') {
    return tenantId !== null && asset.tenantId === tenantId;
  }

  if (asset.visibility === 'owner') {
    return userId !== null && asset.ownerId === userId;
  }

  return false;
}

export function canDownloadAsset(
  asset: any,
  tenantId: string | null,
  userId: string | null,
  userRole?: string
): boolean {
  return canReadAsset(asset, tenantId, userId, userRole);
}

export function canDeleteAsset(
  asset: any,
  tenantId: string | null,
  userId: string | null,
  userRole?: string
): boolean {
  if (userRole === 'admin' || userRole === 'owner') {
    return true;
  }
  
  if (tenantId && asset.tenantId !== tenantId) {
    return false;
  }

  return userId !== null && (asset.ownerId === userId || asset.uploadedBy === userId);
}

export function canRestoreAsset(
  asset: any,
  tenantId: string | null,
  userId: string | null,
  userRole?: string
): boolean {
  return canDeleteAsset(asset, tenantId, userId, userRole);
}

export function canGenerateSignedUrl(
  asset: any,
  tenantId: string | null,
  userId: string | null,
  userRole?: string
): boolean {
  return canReadAsset(asset, tenantId, userId, userRole);
}
