import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import 'dotenv/config';

// Initialize S3/R2 client
const bucket = process.env.BUCKET_NAME || 'revelis-backups';
const endpoint = process.env.S3_ENDPOINT;

if (!process.env.DATABASE_URL) {
  console.error('[Backup] DATABASE_URL is not set.');
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: endpoint,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.SECRET_KEY_ID || process.env.S3_SECRET_KEY || '',
  },
});

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const tempFile = path.join(os.tmpdir(), `revelis-backup-${timestamp}.dump`);

console.log('[Backup] Starting database backup creation...');

// pg_dump -F c creates a compressed custom format archive
const cmd = `pg_dump "${process.env.DATABASE_URL}" -F c -b -v -f "${tempFile}"`;

exec(cmd, async (error, stdout, stderr) => {
  if (error) {
    console.error('[Backup] pg_dump failed:', error.message);
    console.error(stderr);
    process.exit(1);
  }

  console.log('[Backup] pg_dump completed successfully. Output size:', fs.statSync(tempFile).size, 'bytes');

  try {
    const fileStream = fs.createReadStream(tempFile);
    const key = `backups/revelis-db-${timestamp}.dump`;

    console.log(`[Backup] Uploading backup to R2: bucket=${bucket}, key=${key}`);

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'application/octet-stream'
    }));

    console.log('[Backup] Database backup uploaded to R2 successfully!');
    
    // Clean up local temp file
    fs.unlinkSync(tempFile);
    console.log('[Backup] Temporary file cleaned up.');
    process.exit(0);
  } catch (uploadError) {
    console.error('[Backup] Failed to upload backup to R2:', uploadError);
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    process.exit(1);
  }
});
