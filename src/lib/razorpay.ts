import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of two hex signature strings. Returns false on any
 * length mismatch without leaking timing, and never throws.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export class RazorpayClient {
  private static instance: RazorpayClient | null = null;
  private keyId: string;
  private keySecret: string;
  private baseUrl = 'https://api.razorpay.com/v1';

  private constructor() {
    const mode = env.RAZORPAY_MODE;
    if (mode === 'test') {
      this.keyId = env.RAZORPAY_TEST_KEY_ID;
      this.keySecret = env.RAZORPAY_SECRET_KEY;
    } else {
      this.keyId = env.RAZORPAY_KEY_ID;
      this.keySecret = env.RAZORPAY_KEY_SECRET;
    }

    if (!this.keyId || !this.keySecret) {
      throw new Error(`[RazorpayClient] Missing Razorpay credentials for mode "${mode}". Ensure RAZORPAY_TEST_KEY_ID and RAZORPAY_SECRET_KEY (or RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET) are set.`);
    }

    logger.info(`[RazorpayClient] Initialized in ${mode} mode (Key ID: ${this.keyId.substring(0, 12)}...)`);
  }

  public getKeyId(): string {
    return this.keyId;
  }

  public static getInstance(): RazorpayClient {
    if (!RazorpayClient.instance) {
      RazorpayClient.instance = new RazorpayClient();
    }
    return RazorpayClient.instance;
  }

  /**
   * Helper to perform HTTPS requests to the Razorpay API with timeouts and retries
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: any,
    retries = 3,
    timeoutMs = 10000,
    idempotencyKey?: string
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const logDetails = { method, path, attempt: 0 };
    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;

    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    };
    // Razorpay dedupes writes carrying the same Idempotency-Key, so retries and
    // racing duplicate requests cannot create a second refund at the gateway.
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    let lastError: Error | null = null;

    while (logDetails.attempt < retries) {
      logDetails.attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const startTime = Date.now();

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });

        const latency = Date.now() - startTime;
        clearTimeout(timeoutId);

        const requestId = response.headers.get('x-razorpay-request-id') || response.headers.get('x-request-id') || '';

        if (!response.ok) {
          const responseBody = await response.text();
          logger.error('[RazorpayClient] Request failed with non-2xx status', {
            method,
            path,
            statusCode: response.status,
            requestId,
            latencyMs: latency,
            attempt: logDetails.attempt,
            response: responseBody
          });
          throw new Error(`Razorpay API error: ${response.status} - ${responseBody}`);
        }

        const responseJson = await response.json() as any;

        logger.info('[RazorpayClient] Request succeeded', {
          method,
          path,
          statusCode: response.status,
          requestId,
          latencyMs: latency,
          attempt: logDetails.attempt,
          razorpayId: responseJson?.id || responseJson?.order_id || responseJson?.payment_id || ''
        });

        return responseJson as T;
      } catch (error: any) {
        const latency = Date.now() - startTime;
        clearTimeout(timeoutId);

        logger.error('[RazorpayClient] Request encountered an error', {
          method,
          path,
          latencyMs: latency,
          attempt: logDetails.attempt,
          error: error.message
        });

        lastError = error;

        if (logDetails.attempt >= retries) {
          throw error;
        }

        // Exponential backoff: 2s, 4s, 8s...
        const backoffMs = Math.pow(2, logDetails.attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError || new Error(`[RazorpayClient] Request failed after ${retries} attempts`);
  }

  /**
   * Create Razorpay Order
   */
  public async createOrder(options: { amount: number; currency: string; receipt: string }): Promise<any> {
    logger.info('[RazorpayClient] Creating order', { receipt: options.receipt, currency: options.currency });
    return this.request<any>('POST', '/orders', options);
  }

  /**
   * Fetch payment details by ID
   */
  public async fetchPayment(paymentId: string): Promise<any> {
    logger.info('[RazorpayClient] Fetching payment details', { paymentId });
    return this.request<any>('GET', `/payments/${paymentId}`);
  }

  /**
   * Capture authorized payment
   */
  public async capturePayment(paymentId: string, amount: number, currency: string): Promise<any> {
    logger.info('[RazorpayClient] Capturing payment', { paymentId, amount, currency });
    return this.request<any>('POST', `/payments/${paymentId}/capture`, { amount, currency });
  }

  /**
   * Fetch order details by ID
   */
  public async fetchOrder(orderId: string): Promise<any> {
    logger.info('[RazorpayClient] Fetching order details', { orderId });
    return this.request<any>('GET', `/orders/${orderId}`);
  }

  /**
   * Initiate full or partial refund
   */
  public async refundPayment(options: { payment_id: string; amount?: number; notes?: Record<string, string>; idempotencyKey?: string }): Promise<any> {
    logger.info('[RazorpayClient] Initiating refund', { paymentId: options.payment_id, amount: options.amount });
    if (
      options.payment_id.startsWith('pay_web_') ||
      options.payment_id.startsWith('pay_mob_') ||
      options.payment_id.startsWith('pay_mock_')
    ) {
      logger.info('[RazorpayClient] Simulated payment ID detected. Returning mock refund response.');
      return {
        id: `rfnd_mock_${Date.now()}`,
        status: 'processed',
        amount: options.amount || 0,
        payment_id: options.payment_id
      };
    }
    return this.request<any>('POST', '/refunds', {
      payment_id: options.payment_id,
      amount: options.amount,
      notes: options.notes
    }, 3, 10000, options.idempotencyKey);
  }

  /**
   * List payments from Razorpay
   */
  public async listPayments(options?: { from?: number; to?: number; count?: number; skip?: number }): Promise<any> {
    logger.info('[RazorpayClient] Listing payments', { options });
    const query = options
      ? '?' + new URLSearchParams(Object.entries(options).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return this.request<any>('GET', `/payments${query}`);
  }

  /**
   * List refunds from Razorpay
   */
  public async listRefunds(options?: { from?: number; to?: number; count?: number; skip?: number }): Promise<any> {
    logger.info('[RazorpayClient] Listing refunds', { options });
    const query = options
      ? '?' + new URLSearchParams(Object.entries(options).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return this.request<any>('GET', `/refunds${query}`);
  }

  /**
   * Verify signature of Razorpay Webhook requests
   */
  public verifyWebhookSignature(body: string, signature: string): boolean {
    // Only the dedicated webhook secret is valid here. Falling back to the API
    // secret would let anyone who knows the (more widely used) key sign webhooks.
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('[RazorpayClient] Webhook secret (RAZORPAY_WEBHOOK_SECRET) is missing, validation failed');
      return false;
    }

    try {
      const expectedSignature = createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      return timingSafeEqualHex(expectedSignature, signature);
    } catch (error: any) {
      logger.error('[RazorpayClient] Error encountered during webhook signature verification', {
        error: error.message
      });
      return false;
    }
  }
}

export const razorpayClient = RazorpayClient.getInstance();
