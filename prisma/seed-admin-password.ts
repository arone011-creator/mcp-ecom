// prisma/seed-admin-password.ts
//
// The admin password is supplied, never invented.
//
// This used to be the literal `admin123`, baked into the seed and printed
// to the console on every run. On a public deployment that was already
// weak; once POST /api/v1/auth/token existed, a published password stopped
// meaning "someone could log in through the sign-in page" and started
// meaning "anyone can mint a 7-day API token, programmatically". Refusing
// to seed at all is the right failure: an admin account nobody can use is
// recoverable, an admin account everybody can use is not.
//
// The demo *customer* password stays in the seed on purpose. Signing in
// without arranging anything first is the whole point of the demo.

const MINIMUM_LENGTH = 12;

// Not an attempt at a real password policy -- just enough to catch the
// obvious reflexes, including putting the old value straight back.
const TOO_COMMON = new Set([
  'admin123',
  'admin',
  'administrator',
  'password',
  'password123',
  'changeme',
  'letmein',
  'secret',
  'demo1234',
]);

export function requireAdminPassword(
  env: Record<string, string | undefined> = process.env
): string {
  const password = env.ADMIN_PASSWORD?.trim();

  if (!password) {
    throw new Error(
      'ADMIN_PASSWORD is not set. The seed will not invent an admin password ' +
        'for a deployment that is reachable from the internet. Set it in the ' +
        'hosting dashboard (or your local .env.local) and run the seed again.'
    );
  }

  if (TOO_COMMON.has(password.toLowerCase())) {
    throw new Error(
      'ADMIN_PASSWORD is too common to use for an ADMIN account on a public ' +
        'deployment. Choose something that is not on a wordlist.'
    );
  }

  if (password.length < MINIMUM_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MINIMUM_LENGTH} characters.`
    );
  }

  return password;
}
