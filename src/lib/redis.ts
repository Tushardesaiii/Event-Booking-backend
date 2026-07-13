import { cacheService } from './cache.js';

export const redis = {
  async del(key: string) {
    await cacheService.delete(key);
    return 1;
  },
  disconnect() {
    // No-op for REST connection
  }
} as any;

export function getRedisStatus(): boolean {
  return cacheService.getBreakerState() !== 'OPEN' && cacheService.getClient() !== null;
}
