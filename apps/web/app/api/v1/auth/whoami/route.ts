// app/api/v1/auth/whoami/route.ts
//
// GET /api/v1/auth/whoami -- the caller, as this API understands them.
//
// Exists for the MCP server. NextAuth v4 mints an encrypted JWE, not a
// signed JWS, so a non-JS client cannot read the subject out of a token
// without re-implementing NextAuth's HKDF key derivation. Rather than keep
// a second copy of that crypto in Python, the MCP server forwards the
// token it was given and asks here. One implementation of identity,
// the same one every other v1 route uses.
import type { NextRequest } from 'next/server';
import { requireApiUser } from '../../_lib/session';
import { ok, fail } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requireApiUser(req);
  if (!user?.id) return fail(401, 'Authentication required');

  // Deliberately not the whole token: the MCP server needs to know who it
  // is acting for, not everything the session happens to carry.
  return ok({ id: user.id, email: user.email, role: user.role });
}
