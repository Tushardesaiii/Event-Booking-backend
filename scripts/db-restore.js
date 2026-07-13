import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import 'dotenv/config';

const bucket = process.env.BUCKET_NAME || 'revelis-backups';
const endpoint = process.env.S3_ENDPOINT;
const backupKey = process.argv[2];

if (!backupKey) {
  console.error('[Restore] Please specify the backup key to restore. Usage: node scripts/db-restore.js <key>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('[Restore] DATABASE_URL is not set.');
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

const tempFile = path.join(os.tmpdir(), 'revelis-restore-temp.dump');

async function main() {
  try {
    console.log(`[Restore] Downloading backup key "${backupKey}" from R2...`);
    const response = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: backupKey
    }));

    if (!response.Body) {
      throw new Error('Empty response body from R2');
    }

    const writeStream = fs.createWriteStream(tempFile);
    
    // Node stream piping
    await new Promise((resolve, reject) => {
      response.Body.pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });

    console.log('[Restore] Download completed. Size:', fs.statSync(tempFile).size, 'bytes');
    console.log('[Restore] Running pg_restore...');

    // --clean drops database objects before recreating them
    // --no-owner skips restoration of object ownership to avoid user matching issues
    const cmd = `pg_restore --clean --no-owner --dbname="${process.env.DATABASE_URL}" "${tempFile}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('[Restore] pg_restore failed:', error.message);
        console.error(stderr);
        cleanup();
        process.exit(1);
      }

      console.log('[Restore] Database restored successfully!');
      cleanup();
      process.exit(0);
    });
  } catch (err) {
    console.error('[Restore] Restore operation failed:', err);
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
    console.log('[Restore] Temporary files cleaned up.');
  }
}

main();
