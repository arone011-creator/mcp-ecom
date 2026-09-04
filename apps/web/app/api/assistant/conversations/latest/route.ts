// app/api/assistant/conversations/latest/route.ts
//
// GET /api/assistant/conversations/latest -- the conversation to resume.
//
// The panel asks for this once, on mount. It takes no parameters at all:
// the only conversation it can return is the signed-in customer's most
// recent one, so there is nothing here for a caller to tamper with.
//
// Cookie only, like the bridge and the approve route.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../../v1/_lib/respond';
import { loadLatestConversation } from '@/lib/assistant/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  try {
    // null is a normal answer, not an error: everybody has a first visit,
    // and a 404 would put the panel into its failure branch on one.
    const conversation = await loadLatestConversation(session.sub as string);
    return ok({ conversation });
  } catch (error) {
    console.error('GET /api/assistant/conversations/latest failed:', error);
    return fail(500, 'Failed to load your conversation');
  }
}
