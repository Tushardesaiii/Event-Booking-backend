import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { incrementMetric, setMetric } from './metrics.js';

export class R2Error extends Error {
  statusCode?: number;
  details?: any;

  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'R2Error';
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
        logger.info('[R2 CircuitBreaker] Transitioned to HALF_OPEN. Probing connection.');
      } else {
        throw new R2Error('R2 service is temporarily unavailable (circuit breaker is OPEN)', 503);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
        logger.info('[R2 CircuitBreaker] Transitioned to CLOSED. Health check passed.');
      }
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        logger.error(`[R2 CircuitBreaker] Failure count exceeded threshold (${this.failureCount}). Tripping circuit breaker to OPEN.`);
      } else if (this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
        logger.error('[R2 CircuitBreaker] Probe failed in HALF_OPEN state. Returning circuit breaker to OPEN.');
      }

      throw error;
    }
  }

  getState() {
    return this.state;
  }
}

export class R2Client {
  private static instance: R2Client | null = null;
  private client!: S3Client;
  private circuitBreaker = new CircuitBreaker();

  private constructor() {
    this.initializeClient();
  }

  public static getInstance(): R2Client {
    if (!R2Client.instance) {
      R2Client.instance = new R2Client();
    }
    return R2Client.instance;
  }

  private initializeClient() {
    const config: any = {
      region: 'auto',
      credentials: {
        accessKeyId: env.ACCESS_KEY_ID || 'dummy-key',
        secretAccessKey: env.SECRET_KEY_ID || 'dummy-secret'
      }
    };

    if (env.S3_ENDPOINT) {
      config.endpoint = env.S3_ENDPOINT;
      config.forcePathStyle = true;
    } else if (env.CLOUDFLARE_ACCOUNT_ID) {
      config.endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      config.forcePathStyle = true;
    }

    this.client = new S3Client(config);
  }

  private async callWithRetryAndCircuitBreaker<T>(operationName: string, apiCall: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      let attempt = 0;
      const retries = 3;
      const baseDelay = 500;

      while (true) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('R2 API request timeout')), 15000)
          );

          const startTime = Date.now();
          const result = await Promise.race([apiCall(), timeoutPromise]);
          const latency = Date.now() - startTime;
          
          return result;
        } catch (error: any) {
          attempt++;
          incrementMetric('storage_processing_failures_total');

          if (attempt > retries) {
            logger.error(`[R2Client] Operation '${operationName}' failed after ${attempt} attempts`, { error: error.message });
            throw new R2Error(error.message, error.$metadata?.httpStatusCode || 500, error);
          }

          const status = error.$metadata?.httpStatusCode;
          const isRetryable = !status || status === 429 || (status >= 500 && status < 600) || error.message === 'R2 API request timeout';

          if (!isRetryable) {
            throw new R2Error(error.message, status || 500, error);
          }

          const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 200;
          logger.warn(`[R2Client] Retryable error during '${operationName}'. Retrying in ${Math.round(delay)}ms. Attempt ${attempt}/${retries}. Error: ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    });
  }

  // Upload APIs (Priority 1 & 2)

  public async uploadObject(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    return this.uploadBuffer(key, buffer, mimeType);
  }

  public async uploadBuffer(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    return this.callWithRetryAndCircuitBreaker('uploadBuffer', async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key,
          Body: buffer,
          ContentType: mimeType
        })
      );
      incrementMetric('storage_uploads_total');
      return key;
    });
  }

  public async uploadStream(key: string, stream: any, mimeType: string, contentLength?: number): Promise<string> {
    return this.callWithRetryAndCircuitBreaker('uploadStream', async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key,
          Body: stream,
          ContentType: mimeType,
          ContentLength: contentLength
        })
      );
      incrementMetric('storage_uploads_total');
      return key;
    });
  }

  // Multipart uploads (Priority 2)

  public async createMultipartUpload(key: string, mimeType: string): Promise<string> {
    return this.callWithRetryAndCircuitBreaker('createMultipartUpload', async () => {
      const res = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key,
          ContentType: mimeType
        })
      );
      return res.UploadId || '';
    });
  }

  public async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer | Uint8Array
  ): Promise<{ ETag: string; PartNumber: number }> {
    return this.callWithRetryAndCircuitBreaker('uploadPart', async () => {
      const res = await this.client.send(
        new UploadPartCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body
        })
      );
      if (!res.ETag) {
        throw new Error(`UploadPart returned empty ETag for part ${partNumber}`);
      }
      return {
        ETag: res.ETag,
        PartNumber: partNumber
      };
    });
  }

  public async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ ETag: string; PartNumber: number }>
  ): Promise<string> {
    return this.callWithRetryAndCircuitBreaker('completeMultipartUpload', async () => {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber)
          }
        })
      );
      incrementMetric('storage_uploads_total');
      return key;
    });
  }

  public async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.callWithRetryAndCircuitBreaker('abortMultipartUpload', async () => {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key,
          UploadId: uploadId
        })
      );
    });
  }

  public async listMultipartUploads(): Promise<any> {
    return this.callWithRetryAndCircuitBreaker('listMultipartUploads', async () => {
      const res = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: env.BUCKET_NAME || 'revelis'
        })
      );
      return res.Uploads || [];
    });
  }

  public async uploadMultipartParallel(
    key: string,
    buffer: Buffer,
    mimeType: string,
    partSize = 5 * 1024 * 1024
  ): Promise<string> {
    const uploadId = await this.createMultipartUpload(key, mimeType);
    try {
      const totalSize = buffer.length;
      const numParts = Math.ceil(totalSize / partSize);
      const chunkPromises: Array<Promise<{ ETag: string; PartNumber: number }>> = [];

      for (let i = 0; i < numParts; i++) {
        const start = i * partSize;
        const end = Math.min(start + partSize, totalSize);
        const partBuffer = buffer.subarray(start, end);
        const partNumber = i + 1;

        chunkPromises.push(this.uploadPart(key, uploadId, partNumber, partBuffer));
      }

      const uploadedParts = await Promise.all(chunkPromises);
      await this.completeMultipartUpload(key, uploadId, uploadedParts);
      incrementMetric('storage_multipart_uploads');
      return key;
    } catch (error) {
      await this.abortMultipartUpload(key, uploadId).catch((err) => {
        logger.error(`[R2Client] Failed to abort multipart upload after error`, { key, error: err.message });
      });
      throw error;
    }
  }

  // Deletion APIs (Priority 3)

  public async deleteObject(key: string): Promise<void> {
    await this.callWithRetryAndCircuitBreaker('deleteObject', async () => {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key
        })
      );
      incrementMetric('storage_deletes_total');
    });
  }

  // Read APIs (Priority 2)

  public async headObject(key: string): Promise<{ size: number; mimeType: string; etag?: string }> {
    return this.callWithRetryAndCircuitBreaker('headObject', async () => {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key
        })
      );
      return {
        size: res.ContentLength || 0,
        mimeType: res.ContentType || 'application/octet-stream',
        etag: res.ETag
      };
    });
  }

  public async getObject(key: string): Promise<Buffer> {
    return this.getObjectBuffer(key);
  }

  public async getObjectBuffer(key: string): Promise<Buffer> {
    return this.callWithRetryAndCircuitBreaker('getObjectBuffer', async () => {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key
        })
      );
      if (!res.Body) {
        throw new Error('Object body is empty');
      }
      
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as any) {
        chunks.push(chunk);
      }
      
      incrementMetric('storage_downloads_total');
      return Buffer.concat(chunks);
    });
  }

  public async getObjectStream(key: string, range?: string): Promise<any> {
    return this.callWithRetryAndCircuitBreaker('getObjectStream', async () => {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: env.BUCKET_NAME || 'revelis',
          Key: key,
          Range: range
        })
      );
      incrementMetric('storage_downloads_total');
      return res.Body;
    });
  }

  public async downloadObject(key: string, filePath: string): Promise<void> {
    const stream = await this.getObjectStream(key);
    if (!stream) {
      throw new Error('Object body stream is empty');
    }
    const writeStream = fs.createWriteStream(filePath);
    await pipeline(stream as any, writeStream);
  }

  // Utilities

  public async objectExists(key: string): Promise<boolean> {
    try {
      await this.headObject(key);
      return true;
    } catch (error: any) {
      const isNotFound = error.statusCode === 404 || 
        error.$metadata?.httpStatusCode === 404 ||
        error.message?.includes('NotFound') || 
        error.name === 'NotFound';
      if (isNotFound) {
        return false;
      }
      throw error;
    }
  }

  public async copyObject(sourceKey: string, destKey: string): Promise<void> {
    await this.callWithRetryAndCircuitBreaker('copyObject', async () => {
      const bucketName = env.BUCKET_NAME || 'revelis';
      await this.client.send(
        new CopyObjectCommand({
          Bucket: bucketName,
          CopySource: encodeURIComponent(`${bucketName}/${sourceKey}`),
          Key: destKey
        })
      );
    });
  }

  public async moveObject(sourceKey: string, destKey: string): Promise<void> {
    await this.copyObject(sourceKey, destKey);
    await this.deleteObject(sourceKey);
  }

  public async generatePresignedUploadUrl(key: string, mimeType: string, expiresIn = 300): Promise<string> {
    return this.callWithRetryAndCircuitBreaker('generatePresignedUploadUrl', async () => {
      const command = new PutObjectCommand({
        Bucket: env.BUCKET_NAME || 'revelis',
        Key: key,
        ContentType: mimeType
      });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      incrementMetric('storage_presigned_urls_generated_total');
      return url;
    });
  }

  public async generatePresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return this.callWithRetryAndCircuitBreaker('generatePresignedDownloadUrl', async () => {
      const command = new GetObjectCommand({
        Bucket: env.BUCKET_NAME || 'revelis',
        Key: key
      });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      incrementMetric('storage_presigned_urls_generated_total');
      return url;
    });
  }

  public getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }
}

export const r2Client = R2Client.getInstance();
