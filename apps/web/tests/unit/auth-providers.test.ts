// tests/unit/auth-providers.test.ts
//
// lib/auth.ts registered Google and Email unconditionally with `!`
// assertions on env vars that are not set in the demo deployment, so
// /api/auth/providers advertised three sign-in options of which two could
// only ever fail (finding 6, confirmed over HTTP in finding 29).
//
// EmailProvider is gone rather than conditional: it needs SMTP the demo
// will never have, and its module requires `nodemailer`, an optional peer
// dependency that is not installed. Keeping even a conditional static
// import of it makes lib/auth.ts unloadable under jest -- which is what
// blocked every auth and roles test from running at all (finding 30).

describe('auth providers', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('registers only credentials when no OAuth env vars are set', async () => {
    const { authOptions } = await import('@/lib/auth');
    const ids = authOptions.providers.map((p: any) => p.id);
    expect(ids).toEqual(['credentials']);
  });

  it('registers google when both of its env vars are present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    const { authOptions } = await import('@/lib/auth');
    const ids = authOptions.providers.map((p: any) => p.id);
    expect(ids).toEqual(['google', 'credentials']);
  });

  it('does not register google when only one of its env vars is present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    const { authOptions } = await import('@/lib/auth');
    const ids = authOptions.providers.map((p: any) => p.id);
    expect(ids).toEqual(['credentials']);
  });

  it('never registers an email provider', async () => {
    process.env.EMAIL_SERVER_HOST = 'smtp.example.com';
    const { authOptions } = await import('@/lib/auth');
    const ids = authOptions.providers.map((p: any) => p.id);
    expect(ids).not.toContain('email');
  });
});
