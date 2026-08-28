// tests/unit/roles.test.ts
//
// Two drift bugs live here (findings 4 and 5). The middleware compared
// token.role against a lowercase 'admin' while Prisma stores 'ADMIN', so
// the guard was fail-closed -- it locked genuine admins out rather than
// letting anyone in. And lib/roles.ts declared a SUPER_ADMIN role that no
// user can hold, leaving a permanently-dead escalation branch in the
// permission check.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Role } from '@/lib/roles';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

describe('role consistency', () => {
  it('middleware compares against the uppercase ADMIN value', () => {
    const source = read('middleware.ts');
    expect(source).not.toContain("!== 'admin'");
    expect(source).toContain("!== 'ADMIN'");
  });

  it('guards both the admin pages and the admin API', () => {
    const source = read('middleware.ts');
    expect(source.match(/!== 'ADMIN'/g) ?? []).toHaveLength(2);
  });

  it('redirects denied admins to a page that actually exists', () => {
    // The middleware has always redirected here, but the page was never
    // written, so a permission denial rendered as a 404. Assert the target
    // exists rather than banning the redirect -- two integration tests
    // already document /access-denied as the intended destination.
    expect(read('middleware.ts')).toMatch(
      /redirect\(\s*new URL\('\/access-denied'/
    );
    expect(existsSync(join(process.cwd(), 'app/access-denied/page.tsx'))).toBe(
      true
    );
  });

  it('Role enum matches the Prisma UserRole enum exactly', () => {
    const schema = read('prisma/schema.prisma');
    const start = schema.indexOf('enum UserRole');
    const block = schema.slice(start, schema.indexOf('}', start));
    const prismaRoles = block
      .split('\n')
      .slice(1)
      .map(l => l.trim())
      .filter(Boolean)
      .sort();

    expect(Object.values(Role).sort()).toEqual(prismaRoles);
  });

  it('has no SUPER_ADMIN reference left anywhere in lib/roles.ts', () => {
    expect(read('lib/roles.ts')).not.toContain('SUPER_ADMIN');
  });
});
