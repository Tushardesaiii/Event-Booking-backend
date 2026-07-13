/**
 * Seed a real, login-ready organizer for the Revelis Console (dashboard).
 *
 * The dashboard authenticates organizers against the real backend (no demo
 * organizer account), so local/staging environments need at least one organizer
 * user with a password and an owned tenant workspace. This script creates that,
 * idempotently, straight against the DB — bypassing the phone-OTP signup flow.
 *
 *   npm run seed:organizer
 *
 * Override via env: ORG_EMAIL, ORG_PASSWORD, ORG_NAME, ORG_TENANT, ORG_PHONE.
 *
 * Prints the credentials to sign in with at the dashboard /login.
 */

import { db } from '../db/client.js';
import { hashPassword } from '../lib/password.js';
import {
  createAuthAccount,
  createUserRecord,
  findAuthAccountByProviderAndAccountId,
  findMembershipsForUser
} from '../modules/auth/repository.js';
import { createTenant } from '../modules/tenants/service.js';

const EMAIL = (process.env.ORG_EMAIL ?? 'organizer@revelis.app').trim().toLowerCase();
const PASSWORD = process.env.ORG_PASSWORD ?? 'Organizer@2026';
const FULL_NAME = process.env.ORG_NAME ?? 'Soulbeats Productions';
const TENANT_NAME = process.env.ORG_TENANT ?? 'Soulbeats Productions';
const PHONE = process.env.ORG_PHONE ?? '+919900000001';
const USERNAME = EMAIL.split('@')[0].replace(/[^a-z0-9_]/gi, '').slice(0, 50) || 'organizer';

async function main() {
  console.log('▶ Seeding organizer for the dashboard…\n');

  // 1. User + email/password auth account (idempotent on the email account).
  let account = await findAuthAccountByProviderAndAccountId(db, 'email', EMAIL);
  let userId: string;

  if (account) {
    userId = account.userId;
    console.log(`• Auth account already exists for ${EMAIL} (user ${userId}) — reusing.`);
  } else {
    const passwordHash = await hashPassword(PASSWORD);

    userId = await db.transaction(async (tx) => {
      const user = await createUserRecord(tx, {
        username: USERNAME,
        full_name: FULL_NAME,
        phoneNumber: PHONE,
        phoneVerifiedAt: new Date(),
        marketingOptIn: false
      });
      if (!user) throw new Error('Failed to create user');

      account = await createAuthAccount(tx, {
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

    console.log(`• Created organizer user ${userId} with email login ${EMAIL}.`);
  }

  // 2. Tenant workspace (owner membership). Skip if the user already owns/joined one.
  const memberships = await findMembershipsForUser(db, userId);
  if (memberships.length > 0) {
    console.log(`• User already belongs to ${memberships.length} tenant(s) — skipping tenant creation.`);
  } else {
    const tenant = await createTenant(
      { id: userId } as Parameters<typeof createTenant>[0],
      { name: TENANT_NAME, city: 'Ahmedabad', country: 'India' },
      // Seeded organizers skip the approval queue so the dashboard is usable
      // immediately in local/staging.
      { approvalStatus: 'approved' }
    );
    console.log(`• Created tenant "${tenant.name}" (slug: ${tenant.slug}) with owner membership.`);
  }

  console.log('\n✅ Done. Sign in at the dashboard /login with:');
  console.log(`     Email:    ${EMAIL}`);
  console.log(`     Password: ${PASSWORD}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
