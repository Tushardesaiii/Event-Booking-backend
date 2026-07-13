import { Client, Receiver } from '@upstash/qstash';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { incrementMetric } from './metrics.js';

export class QStashService {
  private static instance: QStashService | null = null;
  private client: Client | null = null;
  private receiver: Receiver | null = null;

  private constructor() {
    this.initClient();
  }

  public static getInstance(): QStashService {
    if (!QStashService.instance) {
      QStashService.instance = new QStashService();
    }
    return QStashService.instance;
  }

  private initClient() {
    if (env.QSTASH_TOKEN) {
      try {
        this.client = new Client({
          token: env.QSTASH_TOKEN,
          baseUrl: env.QSTASH_URL,
        });
        logger.info('[QStashService] Client initialized successfully');
      } catch (err: any) {
        logger.error('[QStashService] Failed to initialize Client', { error: err.message });
      }
    }

    if (env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY) {
      try {
        this.receiver = new Receiver({
          currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
          nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
        });
        logger.info('[QStashService] Receiver initialized successfully');
      } catch (err: any) {
        logger.error('[QStashService] Failed to initialize Receiver', { error: err.message });
      }
    }
  }

  private isLoopback(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') ||
        hostname.endsWith('.local')
      );
    } catch {
      return false;
    }
  }

  /**
   * Publish a job to QStash
   */
  public async publish(url: string, body: any, options?: { headers?: Record<string, string>; delaySeconds?: number }): Promise<string> {
    if (!this.client) {
      logger.warn('[QStashService] Client not initialized. Simulating publishing.', { url, body });
      incrementMetric('qstash_jobs_published_total');
      return `simulated-qstash-msg-${Date.now()}`;
    }

    if (this.isLoopback(url)) {
      logger.warn('[QStashService] Destination is a loopback/local address. Simulating job publishing.', { url });
      incrementMetric('qstash_jobs_published_total');
      return `simulated-qstash-msg-local-${Date.now()}`;
    }

    try {
      const res = await this.client.publishJSON({
        url,
        body,
        headers: options?.headers,
        delay: options?.delaySeconds,
      });
      incrementMetric('qstash_jobs_published_total');
      logger.info('[QStashService] Job published successfully', { messageId: res.messageId, url });
      return res.messageId;
    } catch (err: any) {
      logger.error('[QStashService] Failed to publish job', { url, error: err.message });
      throw err;
    }
  }

  /**
   * Schedule a recurring job (cron)
   */
  public async schedule(cron: string, url: string, body: any, headers?: Record<string, string>): Promise<string> {
    if (!this.client) {
      logger.warn('[QStashService] Client not initialized. Simulating scheduling.', { cron, url });
      incrementMetric('qstash_jobs_published_total');
      return `simulated-qstash-sched-${Date.now()}`;
    }

    if (this.isLoopback(url)) {
      logger.warn('[QStashService] Destination is a loopback/local address. Simulating job scheduling.', { cron, url });
      incrementMetric('qstash_jobs_published_total');
      return `simulated-qstash-sched-local-${Date.now()}`;
    }

    try {
      const res = await this.client.schedules.create({
        cron,
        destination: url,
        body: JSON.stringify(body),
        headers,
      });
      incrementMetric('qstash_jobs_published_total');
      logger.info('[QStashService] Job scheduled successfully', { scheduleId: res.scheduleId, cron, url });
      return res.scheduleId;
    } catch (err: any) {
      logger.error('[QStashService] Failed to schedule job', { cron, url, error: err.message });
      throw err;
    }
  }

  /**
   * Idempotently ensure a recurring schedule exists for (cron, destination).
   * Safe to call on every boot / every replica — existing matching schedules are
   * left untouched so we never accumulate duplicates.
   */
  public async ensureSchedule(cron: string, url: string, body: any, headers?: Record<string, string>): Promise<string | null> {
    if (!this.client) {
      logger.warn('[QStashService] Client not initialized. Skipping ensureSchedule.', { cron, url });
      return null;
    }
    if (this.isLoopback(url)) {
      logger.warn('[QStashService] Destination is loopback/local. Skipping ensureSchedule.', { cron, url });
      return null;
    }

    try {
      const existing = await this.client.schedules.list();
      const match = Array.isArray(existing)
        ? existing.find((s: any) => s.destination === url && s.cron === cron)
        : undefined;
      if (match) {
        logger.info('[QStashService] Schedule already present', { scheduleId: match.scheduleId, cron, url });
        return match.scheduleId;
      }
    } catch (err: any) {
      logger.warn('[QStashService] Could not list existing schedules; attempting create anyway', { error: err.message });
    }

    return this.schedule(cron, url, body, headers);
  }

  /**
   * Publish a job with delay
   */
  public async delay(seconds: number, url: string, body: any, headers?: Record<string, string>): Promise<string> {
    return this.publish(url, body, { headers, delaySeconds: seconds });
  }

  /**
   * Cancel scheduled or delayed job
   */
  public async cancel(messageId: string): Promise<boolean> {
    if (!this.client) {
      logger.warn('[QStashService] Client not initialized. Simulating cancel.', { messageId });
      return true;
    }

    try {
      await this.client.messages.delete(messageId);
      logger.info('[QStashService] Job cancelled successfully', { messageId });
      return true;
    } catch (err: any) {
      logger.error('[QStashService] Failed to cancel job', { messageId, error: err.message });
      return false;
    }
  }

  /**
   * Verify signature of incoming request
   */
  public async verifySignature(signature: string, body: string, url?: string): Promise<boolean> {
    // Development bypass option (only if not in production and header is missing/mocked)
    if (env.NODE_ENV !== 'production' && (!signature || signature === 'mock-dev-signature')) {
      logger.warn('[QStashService] Missing or mock QStash signature in development. Allowing bypass.');
      return true;
    }

    if (!this.receiver) {
      logger.error('[QStashService] Receiver not initialized (missing signing keys)');
      if (env.NODE_ENV === 'production') {
        return false;
      }
      return true; // Bypass in dev
    }

    try {
      const isValid = await this.receiver.verify({
        signature,
        body,
        url,
      });
      return isValid;
    } catch (err: any) {
      logger.error('[QStashService] Signature verification failed', { error: err.message });
      return false;
    }
  }
}

export const qstashService = QStashService.getInstance();
