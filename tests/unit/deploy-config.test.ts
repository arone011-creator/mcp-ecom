// tests/unit/deploy-config.test.ts
//
// Railway installs into a cold node_modules and then builds. Without a
// generated Prisma client at both points the deploy fails at import time,
// which is a slow and confusing way to discover a one-line config
// problem. These assertions are the cheap guard.
import { readFileSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
);
const schema = readFileSync(
  join(process.cwd(), 'prisma/schema.prisma'),
  'utf-8'
);

describe('deploy configuration', () => {
  it('generates the prisma client after install', () => {
    expect(pkg.scripts.postinstall).toContain('prisma generate');
  });

  it('generates the prisma client during build as well', () => {
    // Belt and braces: a host that installs with --ignore-scripts skips
    // postinstall entirely, and the failure then surfaces as a module
    // error at runtime rather than a build error.
    expect(pkg.scripts.build).toContain('prisma generate');
    expect(pkg.scripts.build).toContain('next build');
  });

  it('declares a node version Railway can honour', () => {
    expect(pkg.engines?.node).toBeDefined();
  });

  it('keeps a migrate-deploy script for the release step', () => {
    expect(pkg.scripts['db:migrate:deploy']).toBe('prisma migrate deploy');
  });

  it('points prisma at a direct connection for migrations', () => {
    // The pooled 6543 connection cannot run migrations; directUrl is what
    // migrate deploy uses.
    expect(schema).toMatch(/directUrl\s*=\s*env\("DIRECT_URL"\)/);
    expect(schema).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });

  it('builds a standalone server for a small deploy image', () => {
    const nextConfig = readFileSync(
      join(process.cwd(), 'next.config.mjs'),
      'utf-8'
    );
    expect(nextConfig).toMatch(/output:\s*'standalone'/);
  });

  it('carries no stripe dependency into the deploy', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter(d => d.includes('stripe'))).toEqual([]);
  });
});
