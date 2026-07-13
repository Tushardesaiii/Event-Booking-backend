import { spawnSync } from 'node:child_process';

const tests = [
  'test:tenant',
  'test:venue',
  'test:event',
  'test:ticket',
  'test:attendee',
  'test:booking',
  'test:inventory',
  'test:issued-ticket',
  'test:analytics',
  'test:slug',
  'test:organizers',
  'test:group-plans',
  'test:group-chat',
  'test:event-polls',
  'test:wishlists',
  'test:follow-system',
  'test:stories',
  'test:notifications',
  'test:email'
] as const;

for (const script of tests) {
  console.log(`\n==> Running ${script}`);

  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    shell: true,
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nAll non-OTP smoke tests completed successfully.');