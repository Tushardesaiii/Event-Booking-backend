import { env } from '../../config/env.js';

// An already-absolute key (http/https) is returned as-is — this supports
// externally-hosted or seeded image URLs stored directly as the asset key,
// without depending on CDN_BASE_URL or Cloudflare image-resizing paths.
function isAbsoluteUrl(key: string): boolean {
  return /^https?:\/\//i.test(key);
}

export const cloudflareCdnService = {
  buildPublicUrl(storageKey: string): string {
    if (isAbsoluteUrl(storageKey)) return storageKey;
    const base = env.CDN_BASE_URL.endsWith('/') ? env.CDN_BASE_URL.slice(0, -1) : env.CDN_BASE_URL;
    return `${base}/${storageKey}`;
  },

  buildThumbnailUrl(storageKey: string): string {
    if (isAbsoluteUrl(storageKey)) return storageKey;
    const base = env.CDN_BASE_URL.endsWith('/') ? env.CDN_BASE_URL.slice(0, -1) : env.CDN_BASE_URL;
    return `${base}/cdn-cgi/image/width=150,height=150,fit=cover,format=auto/${storageKey}`;
  },

  buildSmallUrl(storageKey: string): string {
    const base = env.CDN_BASE_URL.endsWith('/') ? env.CDN_BASE_URL.slice(0, -1) : env.CDN_BASE_URL;
    return `${base}/cdn-cgi/image/width=300,height=300,fit=cover,format=auto/${storageKey}`;
  },

  buildMediumUrl(storageKey: string): string {
    const base = env.CDN_BASE_URL.endsWith('/') ? env.CDN_BASE_URL.slice(0, -1) : env.CDN_BASE_URL;
    return `${base}/cdn-cgi/image/width=600,height=600,fit=cover,format=auto/${storageKey}`;
  },

  buildLargeUrl(storageKey: string): string {
    const base = env.CDN_BASE_URL.endsWith('/') ? env.CDN_BASE_URL.slice(0, -1) : env.CDN_BASE_URL;
    return `${base}/cdn-cgi/image/width=1200,height=1200,fit=contain,format=auto/${storageKey}`;
  },

  async purgeCache(keys: string[]): Promise<void> {
    console.log(`[CloudflareCdnService] Purging cache for keys: ${keys.join(', ')}`);
    if (env.MEDIA_BYPASS_STORAGE || !env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
      return;
    }
    try {
      const urls = keys.map(key => this.buildPublicUrl(key));
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ files: urls })
        }
      );
      if (!response.ok) {
        const body = await response.text();
        console.error(`[CloudflareCdnService] Purge failed: ${response.status} ${body}`);
      } else {
        console.log(`[CloudflareCdnService] Cache purge request sent successfully`);
      }
    } catch (err) {
      console.error(`[CloudflareCdnService] Error purging cache:`, err);
    }
  }
};
