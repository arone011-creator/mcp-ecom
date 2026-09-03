// app/api/v1/_lib/mint.ts
//
// One place that turns a resolved session into a bearer. Two callers:
// POST /api/v1/auth/refresh, and the assistant bridge, which mints one
// per request and never lets it reach the browser.
//
// Factored out rather than duplicated so the two cannot drift about what
// goes into a token. An extra claim in one and not the other is the kind
// of difference nothing fails on until it matters.
//
// Note what this does NOT do: decide who the caller is, or how long the
// token should live. Both are the caller's business, and the refresh
// route's header explains why it resolves identity the way it does.
import { encode } from 'next-auth/jwt';

export type MintableSession = {
  sub: string;
  email?: unknown;
  role?: unknown;
};

export async function mintBearer(
  session: MintableSession,
  secret: string,
  ttlSeconds: number
): Promise<string> {
  return encode({
    token: { sub: session.sub, email: session.email, role: session.role },
    secret,
    maxAge: ttlSeconds,
  });
}
