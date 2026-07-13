import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export class BrevoError extends Error {
  statusCode?: number;
  details?: any;

  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'BrevoError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private failureThreshold = 5;
  private cooldownMs = 10000; // 10 seconds
  private lastFailureTime = 0;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime > this.cooldownMs) {
        this.state = 'HALF_OPEN';
        logger.info('[Brevo CircuitBreaker] Transitioned to HALF_OPEN. Probing connection.');
      } else {
        throw new BrevoError('Brevo service is temporarily unavailable (circuit breaker is OPEN)', 503);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
        logger.info('[Brevo CircuitBreaker] Transitioned to CLOSED. Health check passed.');
      }
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        logger.error(`[Brevo CircuitBreaker] Failure count exceeded threshold (${this.failureCount}). Tripping circuit breaker to OPEN.`);
      } else if (this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
        logger.error('[Brevo CircuitBreaker] Probe failed in HALF_OPEN state. Returning circuit breaker to OPEN.');
      }

      throw error;
    }
  }

  getState() {
    return this.state;
  }
}

export class BrevoCoreClient {
  private static instance: BrevoCoreClient | null = null;
  private client!: BrevoClient;
  private circuitBreaker = new CircuitBreaker();

  private constructor() {
    this.initializeClient();
  }

  public static getInstance(): BrevoCoreClient {
    if (!BrevoCoreClient.instance) {
      BrevoCoreClient.instance = new BrevoCoreClient();
    }
    return BrevoCoreClient.instance;
  }

  private initializeClient() {
    const apiKey = env.BREVO_API_KEY;
    if (!apiKey) {
      logger.warn('[BrevoCoreClient] BREVO_API_KEY is not configured.');
    }
    this.client = new BrevoClient({ apiKey: apiKey || 'dummy-key' });
  }

  private normalizeError(error: any): BrevoError {
    const message = error?.message || error?.body?.message || 'Unknown Brevo API error';
    const status = error?.status || error?.statusCode || error?.response?.status || error?.response?.statusCode || 500;
    const details = error?.body || error?.response?.data || error?.details;
    return new BrevoError(message, status, details);
  }

  private async callWithRetryAndCircuitBreaker<T>(operationName: string, apiCall: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      let attempt = 0;
      const retries = env.EMAIL_MAX_RETRIES ?? 3;
      const baseDelay = 1000;

      while (true) {
        try {
          // Set a timeout for the API call (e.g. 15 seconds)
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Brevo API request timeout')), 15000)
          );
          
          return await Promise.race([apiCall(), timeoutPromise]);
        } catch (error: any) {
          attempt++;
          const normError = this.normalizeError(error);
          
          if (attempt > retries) {
            logger.error(`[BrevoCoreClient] Operation '${operationName}' failed after ${attempt} attempts`, { error: normError.message, details: normError.details });
            throw normError;
          }

          const status = normError.statusCode;
          const isRetryable = !status || status === 429 || (status >= 500 && status < 600) || error.message === 'Brevo API request timeout';
          
          if (!isRetryable) {
            throw normError;
          }

          let delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
          
          // Check for Retry-After header (if response headers are exposed)
          const retryAfter = error?.response?.headers?.['retry-after'];
          if (status === 429 && retryAfter) {
            const parsedSec = parseInt(retryAfter, 10);
            if (!isNaN(parsedSec)) {
              delay = parsedSec * 1000;
            }
          }

          logger.warn(`[BrevoCoreClient] Retryable error during '${operationName}'. Retrying in ${Math.round(delay)}ms. Attempt ${attempt}/${retries}. Error: ${normError.message}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    });
  }

  // --- API Methods ---

  public async sendTransactionalEmail(body: {
    to: { email: string; name?: string }[];
    subject: string;
    htmlContent: string;
    textContent?: string;
    sender?: { email: string; name?: string };
    replyTo?: { email: string; name?: string };
    tags?: string[];
    params?: Record<string, any>;
    headers?: Record<string, string>;
  }) {
    const sender = body.sender || {
      name: env.EMAIL_FROM_NAME || 'Event Platform',
      email: env.EMAIL_FROM || 'no-reply@example.com'
    };

    const replyTo = body.replyTo || (env.EMAIL_REPLY_TO ? {
      name: env.EMAIL_FROM_NAME,
      email: env.EMAIL_REPLY_TO
    } : undefined);

    return this.callWithRetryAndCircuitBreaker('sendTransactionalEmail', () =>
      this.client.transactionalEmails.sendTransacEmail({
        sender,
        to: body.to,
        subject: body.subject,
        htmlContent: body.htmlContent,
        textContent: body.textContent || undefined,
        replyTo,
        tags: body.tags,
        params: body.params,
        headers: body.headers
      })
    );
  }

  public async sendBulkEmail(emails: Array<{
    to: { email: string; name?: string }[];
    subject: string;
    htmlContent: string;
    textContent?: string;
    sender?: { email: string; name?: string };
    replyTo?: { email: string; name?: string };
    tags?: string[];
  }>) {
    const results = [];
    // Process in batches of 10 to protect concurrency rate limit
    for (let i = 0; i < emails.length; i += 10) {
      const batch = emails.slice(i, i + 10);
      const batchPromises = batch.map(email => this.sendTransactionalEmail(email));
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const res of batchResults) {
        if (res.status === 'fulfilled') {
          results.push(res.value);
        } else {
          results.push({ error: res.reason });
        }
      }
    }
    return results;
  }

  public async createCampaign(body: {
    name: string;
    subject: string;
    sender: { email: string; name: string };
    htmlContent: string;
    recipients: { listIds: number[] } | { segmentIds: number[] };
    scheduledAt?: string;
  }) {
    return this.callWithRetryAndCircuitBreaker('createCampaign', () =>
      this.client.emailCampaigns.createEmailCampaign(body as any)
    );
  }

  public async sendCampaign(campaignId: number | string) {
    return this.callWithRetryAndCircuitBreaker('sendCampaign', () =>
      this.client.emailCampaigns.sendEmailCampaignNow(Number(campaignId) as any)
    );
  }

  public async getCampaign(campaignId: number | string) {
    return this.callWithRetryAndCircuitBreaker('getCampaign', () =>
      this.client.emailCampaigns.getEmailCampaign(Number(campaignId) as any)
    );
  }

  public async getEmailEvents(options: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
    days?: number;
    email?: string;
    event?: 'bounces' | 'hardBounces' | 'softBounces' | 'delivered' | 'spam' | 'opened' | 'clicks' | 'invalid' | 'deferred' | 'blocked' | 'unsubscribed';
  }) {
    return this.callWithRetryAndCircuitBreaker('getEmailEvents', () =>
      this.client.transactionalEmails.getEmailEventReport(options as any)
    );
  }

  public async getStatistics() {
    return this.callWithRetryAndCircuitBreaker('getStatistics', () =>
      this.client.transactionalEmails.getAggregatedSmtpReport()
    );
  }

  public getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }
}

export const brevoCoreClient = BrevoCoreClient.getInstance();
