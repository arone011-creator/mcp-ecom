// tests/unit/deploy-config.test.ts
//
// Railway installs into a cold node_modules and then builds. Without a
// generated Prisma client at both points the deploy fails at import time,
// which is a slow and confusing way to discover a one-line config
// problem. These assertions are the cheap guard.
import { existsSync, readFileSync } from 'fs';
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

  // The web app moved to apps/web so a second service (the MCP server) can
  // sit beside it. The move only stays safe while apps/web remains its own
  // project root: Next.js resolves the standalone entrypoint relative to the
  // tracing root, so promoting the repository root into a package -- an npm
  // workspaces manifest, a stray package.json -- nests the emitted server
  // under the package path and Railway's `node server.js` stops finding it.
  it('keeps apps/web as its own project root, not a workspace member', () => {
    const repoRoot = join(process.cwd(), '..', '..');

    for (const manifest of [
      'package.json',
      'pnpm-workspace.yaml',
      'lerna.json',
    ]) {
      expect({
        manifest,
        exists: existsSync(join(repoRoot, manifest)),
      }).toEqual({ manifest, exists: false });
    }

    // Its own lockfile, resolved from its own directory.
    expect(existsSync(join(process.cwd(), 'package-lock.json'))).toBe(true);
    expect(pkg.workspaces).toBeUndefined();
  });

  // Railway builds this service with RAILPACK -- unless it finds a
  // Dockerfile at the service root, in which case it silently switches to
  // the Docker builder. That already broke one deploy: relocating
  // docker/Dockerfile to apps/web/Dockerfile changed the production build
  // system as a side effect of tidying, and the Dockerfile (never used in
  // production, so never exercised) failed on the first npm ci.
  // The Dockerfile lives under docker/ to stay out of auto-detection.
  it('keeps the Dockerfile out of the builder auto-detection path', () => {
    expect(existsSync(join(process.cwd(), 'Dockerfile'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'docker/Dockerfile'))).toBe(true);
  });

  // The lockfile only resolves with legacy-peer-deps, so any build that
  // installs without .npmrc present dies on ERESOLVE.
  it('gives the docker build the .npmrc that npm ci depends on', () => {
    const dockerfile = readFileSync(
      join(process.cwd(), 'docker/Dockerfile'),
      'utf-8'
    );
    const copiesNpmrc = dockerfile
      .split(/\r?\n/)
      .some(line => line.startsWith('COPY') && line.includes('.npmrc'));

    const npmrc = readFileSync(join(process.cwd(), '.npmrc'), 'utf-8').trim();

    expect({ copiesNpmrc, npmrc }).toEqual({
      copiesNpmrc: true,
      npmrc: 'legacy-peer-deps=true',
    });
  });

  it('carries no stripe dependency into the deploy', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter(d => d.includes('stripe'))).toEqual([]);
  });
});
