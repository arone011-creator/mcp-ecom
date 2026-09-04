// app/api/assistant/conversations/route.ts
//
// GET /api/assistant/conversations -- every chat this customer has had.
//
// Takes no parameters, like the resume route. The only chats it can
// return are the signed-in customer's, so there is nothing here for a
// caller to tamper with.
//
// Cookie only, like every other route in this folder.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../v1/_lib/respond';
import { listConversations } from '@/lib/assistant/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  try {
    // An empty list is a normal answer. Everybody has a first visit.
    const conversations = await listConversations(session.sub as string);
    return ok({ conversations });
  } catch (error) {
    console.error('GET /api/assistant/conversations failed:', error);
    return fail(500, 'Failed to load your chats');
  }
}
