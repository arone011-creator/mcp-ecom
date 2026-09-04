// app/api/assistant/conversations/[id]/route.ts
//
//   GET     one chat in full, to open it
//   DELETE  remove it
//
// BOTH ANSWER 404 FOR A CHAT THAT IS NOT THIS CUSTOMER'S, and the same
// 404 for one that does not exist. A distinguishable refusal -- a 403, or
// a different message -- confirms that a stranger's id is real, which is
// all an enumeration attack needs. The store enforces this by filtering
// on userId inside the query, so there is no path here that can forget.
//
// Cookie only, like the bridge and the approve route.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../../v1/_lib/respond';
import {
  deleteConversation,
  loadConversation,
} from '@/lib/assistant/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  try {
    const conversation = await loadConversation(session.sub as string, id);
    if (!conversation) return fail(404, 'No such conversation');
    return ok({ conversation });
  } catch (error) {
    console.error('GET /api/assistant/conversations/[id] failed:', error);
    return fail(500, 'Failed to load that chat');
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  try {
    const deleted = await deleteConversation(session.sub as string, id);
    // Same 404 as GET. "Nothing of yours to delete" and "does not exist"
    // are the same answer on purpose.
    if (!deleted) return fail(404, 'No such conversation');
    return ok({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/assistant/conversations/[id] failed:', error);
    return fail(500, 'Failed to delete that chat');
  }
}
