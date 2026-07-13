/**
 * Seed a real platform/super-admin account for the Revelis Console.
 * Adds the `users.is_platform_admin` column if missing (idempotent), then
 * creates (or upgrades) the admin user.
 *
 *   npm run seed:superadmin
 *
 * Override via env: SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME.
 */
import { db, sql } from '../db/client.js';
import { hashPassword } from '../lib/password.js';
import {
  createAuthAccount,
  createUserRecord,
  findAuthAccountByProviderAndAccountId
} from '../modules/auth/repository.js';

const EMAIL = (process.env.SUPERADMIN_EMAIL ?? 'admin@revelis.app').trim().toLowerCase();
const PASSWORD = process.env.SUPERADMIN_PASSWORD ?? 'Admin@Revelis2026';
const FULL_NAME = process.env.SUPERADMIN_NAME ?? 'Platform Admin';
const USERNAME = process.env.SUPERADMIN_USERNAME ?? 'superadmin';
const PHONE = process.env.SUPERADMIN_PHONE ?? '+919900000099';

async function main() {
  console.log('▶ Seeding super-admin…\n');

  // Ensure the column exists even if the Drizzle schema hasn't been migrated.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false`;

  const existing = await findAuthAccountByProviderAndAccountId(db, 'email', EMAIL);
  let userId: string;

  if (existing) {
    userId = existing.userId;
    console.log(`• Account already exists for ${EMAIL} (user ${userId}) — upgrading to platform admin.`);
  } else {
    const passwordHash = await hashPassword(PASSWORD);
    userId = await db.transaction(async (tx) => {
      const user = await createUserRecord(tx, {
        username: USERNAME,
        full_name: FULL_NAME,
        phoneNumber: PHONE,
        phoneVerifiedAt: new Date()
      });
      if (!user) throw new Error('Failed to create user');

      const account = await createAuthAccount(tx, {
        userId: user.id,
        provider: 'email',
        email: EMAIL,
        passwordHash,
        providerAccountId: EMAIL,
        isPrimary: true,
        isVerified: true
      });
      if (!account) throw new Error('Failed to create auth account');

      return user.id;
    });
    console.log(`• Created super-admin user ${userId}.`);
  }

  await sql`update users set is_platform_admin = true where id = ${userId}`;

  console.log('\n✅ Done. Sign in at the dashboard /login with:');
  console.log(`     Email:    ${EMAIL}`);
  console.log(`     Password: ${PASSWORD}\n`);

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n❌ Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
