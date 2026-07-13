import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';

export interface StorageProvider {
  upload(bucket: string, key: string, fileBuffer: Buffer, mimeType: string): Promise<void>;
  delete(bucket: string, key: string): Promise<void>;
  getSignedUploadUrl(bucket: string, key: string, mimeType: string, expiresInSeconds?: number): Promise<string>;
  getSignedDownloadUrl(bucket: string, key: string, expiresInSeconds?: number): Promise<string>;
  exists(bucket: string, key: string): Promise<boolean>;
}

export class S3StorageProvider implements StorageProvider {
  private s3Client: S3Client | null = null;

  constructor() {
    const isProduction = env.NODE_ENV === 'production';
    if (!env.MEDIA_BYPASS_STORAGE || isProduction) {
      // R2 credentials (shared with src/lib/r2.ts). Provided under the R2-style
      // names; S3_* names are accepted as a fallback for S3-compatible setups.
      const accessKeyId = env.ACCESS_KEY_ID || env.S3_ACCESS_KEY;
      const secretAccessKey = env.SECRET_KEY_ID || env.S3_SECRET_KEY;
      if (isProduction && (!accessKeyId || !secretAccessKey)) {
        throw new Error('Object storage access key and secret key must be configured in production');
      }
      const config: any = {
        // R2 requires the 'auto' region; honour an explicit S3_REGION otherwise.
        region: env.S3_REGION || 'auto',
        credentials: {
          accessKeyId,
          secretAccessKey
        }
      };

      if (env.S3_ENDPOINT) {
        config.endpoint = env.S3_ENDPOINT;
        config.forcePathStyle = true; // R2 / MinIO / custom S3-compatible endpoints require path style
      } else if (env.CLOUDFLARE_ACCOUNT_ID) {
        config.endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
        config.forcePathStyle = true;
      }

      this.s3Client = new S3Client(config);
    }
  }

  async upload(bucket: string, key: string, fileBuffer: Buffer, mimeType: string): Promise<void> {
    const isProduction = env.NODE_ENV === 'production';
    if ((env.MEDIA_BYPASS_STORAGE && !isProduction) || !this.s3Client) {
      return;
    }
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType
      })
    );
  }

  async delete(bucket: string, key: string): Promise<void> {
    const isProduction = env.NODE_ENV === 'production';
    if ((env.MEDIA_BYPASS_STORAGE && !isProduction) || !this.s3Client) {
      return;
    }
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );
  }

  async getSignedUploadUrl(bucket: string, key: string, mimeType: string, expiresInSeconds = 3600): Promise<string> {
    const isProduction = env.NODE_ENV === 'production';
    if ((env.MEDIA_BYPASS_STORAGE && !isProduction) || !this.s3Client) {
      return `${env.CDN_BASE_URL}/${key}?mock-signed-upload=true&expires=${expiresInSeconds}`;
    }
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  async getSignedDownloadUrl(bucket: string, key: string, expiresInSeconds = 3600): Promise<string> {
    const isProduction = env.NODE_ENV === 'production';
    if ((env.MEDIA_BYPASS_STORAGE && !isProduction) || !this.s3Client) {
      return `${env.CDN_BASE_URL}/${key}?mock-signed-download=true&expires=${expiresInSeconds}`;
    }
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    const isProduction = env.NODE_ENV === 'production';
    if ((env.MEDIA_BYPASS_STORAGE && !isProduction) || !this.s3Client) {
      return true;
    }
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}

export const storageProvider = new S3StorageProvider();
