// app/api/v1/_lib/session.ts
//
// The single identity choke point for the v1 API. Every route resolves its
// caller through requireApiUser and nothing else, so there is exactly one
// place to audit when asking "how does this API decide who you are".
//
// Two credentials are accepted, both carrying the *same* NextAuth JWT:
//
//   - `Authorization: Bearer <token>` -- for non-browser clients (the MCP
//     server, scripts, agents). Tokens come from POST /api/v1/auth/token.
//   - the NextAuth session cookie -- for the storefront's own fetches.
//
// Sharing one trust root means the API can never disagree with the
// storefront about who is signed in, and no second secret exists to rotate.
import { decode, getToken } from 'next-auth/jwt';
import type { JWT } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

export type ApiUser = {
  id: string;
  email: string | null;
  role: string;
};

/**
 * Pulls the raw token out of an `Authorization: Bearer` header, or null if
 * the header is absent, uses another scheme, or carries no value.
 */
function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;

  const [scheme = '', ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== 'bearer') return null;

  const value = rest.join(' ');
  if (!value) return null;

  // next-auth url-decodes the bearer value before decrypting it; match that
  // so a token that works against getToken also works here.
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toApiUser(token: JWT | null): ApiUser | null {
  // A token without a subject cannot authorise anything -- the ownership
  // checks downstream are all keyed on the id.
  if (!token?.sub) return null;

  return {
    id: token.sub,
    email: typeof token.email === 'string' ? token.email : null,
    role: typeof token.role === 'string' ? token.role : 'USER',
  };
}

/**
 * Resolves the caller, or null if the request carries no usable credential.
 * Routes turn null into a 401; this function never throws and never
 * distinguishes "missing" from "invalid" to the caller.
 */
export async function requireApiUser(req: NextRequest): Promise<ApiUser | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  // Without a secret nothing can be verified. Failing closed matters more
  // than a helpful error: a misconfigured deploy must not authenticate.
  if (!secret) return null;

  const bearer = bearerToken(req);
  if (bearer) {
    // The explicit credential wins over the ambient cookie, and a bearer
    // token that fails to decode is a hard no -- never a silent downgrade
    // to whatever session cookie happened to ride along on the request.
    try {
      return toApiUser(await decode({ token: bearer, secret }));
    } catch {
      return null;
    }
  }

  // getToken reads the session cookie, deriving the `__Secure-` prefix from
  // NEXTAUTH_URL exactly as the sign-in flow does when it writes the cookie.
  return toApiUser(await getToken({ req, secret }));
}
