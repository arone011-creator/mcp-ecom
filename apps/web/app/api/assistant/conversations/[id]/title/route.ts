// app/api/assistant/conversations/[id]/title/route.ts
//
// POST -- name a conversation after its first exchange.
//
// THE REQUEST CARRIES NO BODY, AND THAT IS THE DESIGN. The obvious
// version has the browser POST the exchange it just watched. That would
// make this endpoint two things it must not be: a way to put
// attacker-chosen text in front of the model on this project's account,
// and a way to write a near-arbitrary string into a row that is rendered
// on every future page load of the panel. Reading turn zero back out of
// the database costs one query and removes both.
//
// IT NEVER FAILS IN A WAY THE BROWSER HAS TO HANDLE. A chat always has a
// usable name already -- the customer's own first message -- so every way
// this can go wrong answers 200 with a null title and leaves the row
// alone.
//
// Cookie only, like the bridge and the other conversation routes.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../../../v1/_lib/respond';
import {
  firstExchange,
  nameConversation,
} from '@/lib/assistant/conversation-store';
import { replay } from '@/lib/assistant/events';
import type { AssistantEvent } from '@/lib/assistant/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The same 60 the fallback name is truncated at, so a title and a
 * fallback are cut to the same width and the list stays even. The agent
 * caps at 60 too; three constants with one value, in three modules that
 * must not import each other.
 */
const TITLE_LIMIT = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const agentUrl = process.env.AGENT_SERVICE_URL;
  const agentKey = process.env.AGENT_SERVICE_KEY;

  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  const exchange = await firstExchange(session.sub as string, id);
  // The same 404 as a conversation that does not exist, and the same one
  // as a conversation with no turns yet: none of them is nameable, and a
  // distinguishable refusal confirms a stranger's id is real.
  if (!exchange) return fail(404, 'No such conversation');

  // Already named. Checked before the model call rather than only at the
  // write, so a re-fired request costs a query rather than a token.
  if (exchange.title) return ok({ title: exchange.title });

  if (!agentUrl || !agentKey) return ok({ title: null });

  // The answer the customer actually saw, rebuilt with the same reducer
  // the panel renders from. Never re-derived here: one mapping, one
  // implementation.
  const answer = replay(exchange.events as AssistantEvent[]).text.join('\n');

  let raw: unknown = null;
  try {
    const response = await fetch(`${agentUrl}/title`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': agentKey },
      body: JSON.stringify({ utterance: exchange.utterance, answer }),
    });

    if (response.ok) raw = (await response.json())?.title;
  } catch {
    // A name is never worth an error. The fallback is already on screen.
  }

  // The agent cleans its own output; this is the layer that does not
  // depend on that one being right, and it is two lines.
  if (typeof raw !== 'string' || !raw.trim()) return ok({ title: null });
  const title = raw.trim().slice(0, TITLE_LIMIT);

  await nameConversation(session.sub as string, id, title);

  return ok({ title });
}
