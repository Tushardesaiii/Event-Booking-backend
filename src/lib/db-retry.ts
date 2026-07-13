import { db } from '../db/client.js';

export async function withTransactionRetry<T>(
  fn: (tx: any) => Promise<T>,
  options?: { maxAttempts?: number; delayMs?: number }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const delayMs = options?.delayMs ?? 100;
  let attempt = 0;

  while (true) {
    attempt++;
    try {
      return await db.transaction(fn);
    } catch (error: any) {
      const isRetryable =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === '40P01' || error.code === '40001');

      if (isRetryable && attempt < maxAttempts) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
}
