// tests/unit/seed-admin-password.test.ts
//
// The seed hardcoded `admin123` for an ADMIN-role account on a publicly
// reachable deployment. That was already weak; POST /api/v1/auth/token
// makes it worse, because a published password now buys a 7-day API token
// programmatically, with no browser and no rate limit that matters once
// you already know the answer.
//
// The demo *customer* account stays open deliberately -- being able to
// sign in without arranging anything is the point of the demo. The admin
// account is a different thing entirely, and the seed now refuses to
// invent a password for it.
import { readFileSync } from 'fs';
import { join } from 'path';
import { requireAdminPassword } from '@/prisma/seed-admin-password';

const STRONG = 'a-properly-long-admin-secret';

describe('requireAdminPassword', () => {
  it('returns the configured password', () => {
    expect(requireAdminPassword({ ADMIN_PASSWORD: STRONG })).toBe(STRONG);
  });

  it('trims surrounding whitespace', () => {
    expect(requireAdminPassword({ ADMIN_PASSWORD: `  ${STRONG}  ` })).toBe(
      STRONG
    );
  });

  it('refuses to seed when ADMIN_PASSWORD is unset', () => {
    expect(() => requireAdminPassword({})).toThrow(/ADMIN_PASSWORD/);
  });

  it('refuses a blank password', () => {
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: '   ' })).toThrow(
      /ADMIN_PASSWORD/
    );
  });

  // Named explicitly so that pasting the old value back in fails loudly
  // rather than quietly restoring the thing this exists to prevent.
  it('refuses the password it used to hardcode', () => {
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: 'admin123' })).toThrow(
      /too common/i
    );
  });

  it.each(['password', 'admin', 'changeme', 'letmein'])(
    'refuses the common password %p',
    (candidate) => {
      expect(() =>
        requireAdminPassword({ ADMIN_PASSWORD: candidate })
      ).toThrow(/too common/i);
    }
  );

  it('refuses a password short enough to be worth guessing', () => {
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: 'short1' })).toThrow(
      /12 characters/
    );
  });

  it('reads from the real environment when given no explicit source', () => {
    const previous = process.env.ADMIN_PASSWORD;
    (process.env as any).ADMIN_PASSWORD = STRONG;

    try {
      expect(requireAdminPassword()).toBe(STRONG);
    } finally {
      if (previous === undefined) delete (process.env as any).ADMIN_PASSWORD;
      else (process.env as any).ADMIN_PASSWORD = previous;
    }
  });
});

describe('prisma/seed.ts', () => {
  const seedSource = readFileSync(
    join(process.cwd(), 'prisma/seed.ts'),
    'utf-8'
  );

  it('no longer contains the hardcoded admin password', () => {
    expect(seedSource).not.toContain('admin123');
  });

  it('resolves the admin password through the guard', () => {
    expect(seedSource).toContain('requireAdminPassword');
  });

  // It used to print it on every run, which puts it in Railway's deploy
  // logs and in the scrollback of anyone who has ever seeded this.
  it('does not print the admin password to the console', () => {
    expect(seedSource).not.toMatch(/console\.log\(\s*['"`]Password:/);
  });
});

describe('scripts/set-admin-password.ts', () => {
  const scriptSource = readFileSync(
    join(process.cwd(), 'scripts/set-admin-password.ts'),
    'utf-8'
  );

  it('resolves the password through the same guard the seed uses', () => {
    expect(scriptSource).toContain('requireAdminPassword');
  });

  // Targets interpolating the value, not the word: "Admin password
  // updated" is a fine thing to print, `${password}` is not.
  it('never interpolates the password into its output', () => {
    expect(scriptSource).not.toMatch(
      /console\.(log|error)\([^)]*\$\{[^}]*password/i
    );
  });

  it('writes the admin role alongside the password', () => {
    expect(scriptSource).toContain('role: UserRole.ADMIN');
  });
});
