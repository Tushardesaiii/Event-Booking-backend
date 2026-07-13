import { Redis as UpstashRedis } from '@upstash/redis';
import { Redis as IoRedis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { incrementMetric, setMetric } from './metrics.js';

// Circuit Breaker State Type
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastStateChange: number = Date.now();
  private readonly failureThreshold = 5;
  private readonly cooldownPeriodMs = 10000; // 10 seconds

  public getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  public recordSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
      logger.info('[Cache CircuitBreaker] State transitioned to CLOSED');
    }
  }

  public recordFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold && this.state !== 'OPEN') {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
      logger.error(`[Cache CircuitBreaker] Failure threshold reached. State transitioned to OPEN.`);
    }
  }

  private updateState() {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed > this.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = Date.now();
        logger.warn('[Cache CircuitBreaker] Cooldown elapsed. State transitioned to HALF_OPEN.');
      }
    }
  }
}

export interface RedisClientAdapter {
  get(key: string): Promise<any>;
  set(key: string, value: string, options?: { ex?: number; nx?: boolean }): Promise<any>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  eval(script: string, keys: string[], args: string[]): Promise<any>;
}

class UpstashRedisAdapter implements RedisClientAdapter {
  constructor(private client: UpstashRedis) {}

  async get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, options?: { ex?: number; nx?: boolean }) {
    if (options) {
      return this.client.set(key, value, options as any);
    }
    return this.client.set(key, value);
  }

  async del(key: string) {
    return this.client.del(key);
  }

  async exists(key: string) {
    return this.client.exists(key);
  }

  async incr(key: string) {
    return this.client.incr(key);
  }

  async ttl(key: string) {
    return this.client.ttl(key);
  }

  async eval(script: string, keys: string[], args: string[]) {
    return this.client.eval(script, keys, args);
  }
}

class IoRedisAdapter implements RedisClientAdapter {
  constructor(private client: IoRedis) {}

  async get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, options?: { ex?: number; nx?: boolean }) {
    if (options) {
      const args: any[] = [key, value];
      if (options.ex !== undefined) {
        args.push('EX', options.ex);
      }
      if (options.nx) {
        args.push('NX');
      }
      const res = await this.client.set(args[0], args[1], ...args.slice(2));
      return res;
    }
    return this.client.set(key, value);
  }

  async del(key: string) {
    return this.client.del(key);
  }

  async exists(key: string) {
    const res = await this.client.exists(key);
    return res;
  }

  async incr(key: string) {
    return this.client.incr(key);
  }

  async ttl(key: string) {
    return this.client.ttl(key);
  }

  async eval(script: string, keys: string[], args: string[]) {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }
}

class CacheService {
  private client: RedisClientAdapter | null = null;
  private rawIoClient: IoRedis | null = null;
  private breaker = new CircuitBreaker();
  // Fencing tokens for locks held by this process (see lock/unlock).
  private lockTokens = new Map<string, string>();

  constructor() {
    this.initClient();
  }

  private initClient() {
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      try {
        const upstashClient = new UpstashRedis({
          url: env.UPSTASH_REDIS_REST_URL,
          token: env.UPSTASH_REDIS_REST_TOKEN,
        });
        this.client = new UpstashRedisAdapter(upstashClient);
        setMetric('redis_connected', 1);
        logger.info('[CacheService] Upstash Redis initialized successfully');
      } catch (err: any) {
        setMetric('redis_connected', 0);
        logger.error('[CacheService] Failed to initialize Upstash Redis client', { error: err.message });
      }
    } else if (env.REDIS_URL) {
      try {
        logger.info(`[CacheService] Connecting to standard Redis via ioredis: ${env.REDIS_URL}`);
        this.rawIoClient = new IoRedis(env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          retryStrategy(times) {
            return Math.min(times * 100, 2000);
          }
        });

        this.rawIoClient.on('error', (err) => {
          setMetric('redis_connected', 0);
          logger.error('[CacheService] ioredis error', { error: err.message });
        });

        this.rawIoClient.on('connect', () => {
          setMetric('redis_connected', 1);
          logger.info('[CacheService] ioredis connected successfully');
        });

        this.client = new IoRedisAdapter(this.rawIoClient);
      } catch (err: any) {
        setMetric('redis_connected', 0);
        logger.error('[CacheService] Failed to initialize ioredis client', { error: err.message });
      }
    } else {
      setMetric('redis_connected', 0);
      logger.warn('[CacheService] Redis configuration not found. Caching is disabled or degraded.');
    }
  }

  public getBreakerState(): CircuitState {
    return this.breaker.getState();
  }

  public getClient(): RedisClientAdapter | null {
    return this.client;
  }

  public async close() {
    if (this.rawIoClient) {
      try {
        await this.rawIoClient.quit();
        logger.info('[CacheService] ioredis connection closed gracefully');
      } catch (err: any) {
        logger.error('[CacheService] Error closing ioredis connection', { error: err.message });
      }
    }
  }

  /**
   * Run operation with Circuit Breaker, Retries with Exponential Backoff, and Timeout
   */
  private async execute<T>(operationName: string, fn: (redis: RedisClientAdapter) => Promise<T>): Promise<T | null> {
    const state = this.breaker.getState();
    if (state === 'OPEN') {
      setMetric('redis_connected', 0);
      incrementMetric('redis_errors_total');
      logger.warn(`[CacheService] Circuit breaker is OPEN. Skipping operation: ${operationName}`);
      return null;
    }

    setMetric('redis_connected', 1);

    if (!this.client) {
      return null;
    }

    let attempt = 0;
    const maxAttempts = 3;
    let delayMs = 100;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        // Wrap command in a timeout
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), 10000)
        );

        incrementMetric('redis_operations_total');
        const result = await Promise.race([fn(this.client), timeoutPromise]);
        this.breaker.recordSuccess();
        return result;
      } catch (err: any) {
        incrementMetric('redis_errors_total');
        logger.warn(`[CacheService] Operation '${operationName}' failed (attempt ${attempt}/${maxAttempts})`, {
          error: err.message || err,
        });

        if (attempt >= maxAttempts) {
          this.breaker.recordFailure();
          logger.error(`[CacheService] Operation '${operationName}' permanently failed after ${maxAttempts} attempts.`, {
            error: err.message || err,
          });
          break;
        }

        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }

    return null;
  }

  public async get<T>(key: string): Promise<T | null> {
    const result = await this.execute('get', (redis) => redis.get(key));
    if (result === null) return null;
    
    // Parse if it's stringified JSON, or return as T
    if (typeof result === 'string') {
      try {
        return JSON.parse(result) as T;
      } catch {
        return result as unknown as T;
      }
    }
    return result as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.execute('set', async (redis) => {
      const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await redis.set(key, serialized, { ex: ttlSeconds });
      } else {
        await redis.set(key, serialized);
      }
    });
  }

  public async delete(key: string): Promise<boolean> {
    const deleted = await this.execute('delete', (redis) => redis.del(key));
    return deleted ? deleted > 0 : false;
  }

  public async exists(key: string): Promise<boolean> {
    const count = await this.execute('exists', (redis) => redis.exists(key));
    return typeof count === 'number' ? count > 0 : !!count;
  }

  public async increment(key: string): Promise<number> {
    const val = await this.execute('increment', (redis) => redis.incr(key));
    return val ?? 0;
  }

  public async lock(key: string, ttlSeconds: number): Promise<boolean> {
    const lockKey = `revelis:lock:${key}`;
    // Store a unique fencing token as the lock value so we can prove ownership on
    // release. Prevents a slow holder from deleting a lock that already expired and
    // was re-acquired by another worker (classic unsafe distributed-lock release).
    const token = randomUUID();
    const acquired = await this.execute('lock', (redis) =>
      redis.set(lockKey, token, { nx: true, ex: ttlSeconds })
    );
    const ok = acquired === 'OK' || acquired === true;
    if (ok) {
      this.lockTokens.set(lockKey, token);
    }
    return ok;
  }

  public async unlock(key: string): Promise<boolean> {
    const lockKey = `revelis:lock:${key}`;
    const token = this.lockTokens.get(lockKey);
    // We only ever release a lock we still own. If we never recorded a token for
    // this key (e.g. we never held it, or it already expired and someone else may
    // hold it now) we must NOT delete it.
    if (!token) {
      return false;
    }
    // Atomic compare-and-delete: only delete if the value is still our token.
    const releaseScript =
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    const deleted = await this.execute('unlock', (redis) => redis.eval(releaseScript, [lockKey], [token]));
    this.lockTokens.delete(lockKey);
    return typeof deleted === 'number' ? deleted > 0 : !!deleted;
  }

  public async ttl(key: string): Promise<number> {
    const seconds = await this.execute('ttl', (redis) => redis.ttl(key));
    return seconds ?? -1;
  }
}

export const cacheService = new CacheService();
