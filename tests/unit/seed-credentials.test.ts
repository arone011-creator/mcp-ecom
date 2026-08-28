// tests/unit/seed-credentials.test.ts
//
// The seed computed a bcrypt hash and then never assigned it, so every
// seeded user landed in the database with a null password and could not
// log in (finding 3, confirmed against the live database in finding 18).
// These are source-level guards; the live proof is the has_password query
// in the task's verification step.
import { readFileSync } from 'fs';
import { join } from 'path';
import { hash, compare } from 'bcryptjs';

const seedSource = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');

// Scoped to the two user upserts on purpose. A blanket ban on `update: {}`
// across the file would also condemn the cart upsert, where leaving an
// existing cart untouched is the correct behaviour.
function upsertBlock(declaration: string): string {
  const start = seedSource.indexOf(declaration);
  expect(start).toBeGreaterThan(-1);
  return seedSource.slice(start, start + 400);
}

describe('seed credentials', () => {
  it('assigns a password to the admin user on create', () => {
    expect(upsertBlock('const admin = await prisma.user.upsert')).toContain(
      'password: adminPassword'
    );
  });

  it('assigns a password to the demo customer on create', () => {
    expect(upsertBlock('const customer = await prisma.user.upsert')).toContain(
      'password: customerPassword'
    );
  });

  it('repairs an existing admin rather than skipping with an empty update', () => {
    const block = upsertBlock('const admin = await prisma.user.upsert');
    expect(block).not.toContain('update: {},');
    expect(block).toContain('update: { password: adminPassword }');
  });

  it('repairs an existing customer rather than skipping with an empty update', () => {
    const block = upsertBlock('const customer = await prisma.user.upsert');
    expect(block).not.toContain('update: {},');
    expect(block).toContain('update: { password: customerPassword }');
  });

  it('produces a verifiable bcrypt hash at the cost factor the seed uses', async () => {
    const hashed = await hash('demo1234', 12);
    await expect(compare('demo1234', hashed)).resolves.toBe(true);
    await expect(compare('wrong', hashed)).resolves.toBe(false);
  });
});
