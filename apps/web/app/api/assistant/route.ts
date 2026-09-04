// app/api/assistant/route.ts
//
// POST /api/assistant -- the browser's only door to the agent.
//
// Decision (C) of the M4 storefront plan: THE BROWSER NEVER SEES A BEARER
// TOKEN AT ALL. This route holds the session cookie, mints a fifteen
// minute token server-side, spends it on one request, and throws it away.
// Nothing long-lived exists in the browser and "refresh" is just "mint
// another one".
//
// TWO THINGS MUST NOT CROSS TO THE BROWSER, not one:
//
//   1. the bearer, which is never written into a response;
//   2. the agent's `control` frames, which carry its MCP session id.
//
// The second is the easier leak, because it arrives looking like ordinary
// stream content and has to be actively withheld. That session id is what
// would let a caller mint an approval against the agent's own MCP
// session, which is the boundary the approval design exists to defend.
// Everything the agent sends is therefore forwarded by exclusion: only
// `assistant` frames go on, and anything else is kept or dropped.
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail } from '../v1/_lib/respond';
import { mintBearer } from '../v1/_lib/mint';
import { REFRESH_TTL_SECONDS } from '../v1/auth/refresh/route';
import { SseParser } from '@/lib/assistant/sse';
import { forgetApprovalsOf, rememberApproval } from '@/lib/assistant/approvals';
import {
  appendTurn,
  ownedConversation,
  startConversation,
} from '@/lib/assistant/conversation-store';
import { forgetTurn, rememberTurn } from '@/lib/assistant/turns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function frame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export async function POST(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const agentUrl = process.env.AGENT_SERVICE_URL;
  const agentKey = process.env.AGENT_SERVICE_KEY;

  // Cookie only, like the refresh route: the caller here is a browser,
  // and a route that also accepted a bearer would let an agent token
  // drive the agent.
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Request body must be JSON');
  }

  const utterance = String(
    (body as { utterance?: unknown })?.utterance ?? ''
  ).trim();
  if (!utterance) return fail(400, 'An utterance is required');

  const asked = (body as { conversationId?: unknown })?.conversationId;
  const continuing = typeof asked === 'string' && asked.length > 0 ? asked : null;

  // Checked after the caller is known but before anything is spent, and
  // the message says nothing about which piece is missing.
  if (!secret || !agentUrl || !agentKey) {
    return fail(500, 'The assistant is not configured');
  }

  // Resolved before anything is spent. A conversation that is not this
  // customer's must not cost a model call to refuse.
  let conversationId: string;
  if (continuing) {
    const owned = await ownedConversation(session.sub as string, continuing);
    // The same answer as one that does not exist: a distinguishable
    // refusal confirms a stranger's id is real.
    if (!owned) return fail(404, 'No such conversation');
    conversationId = owned.id;
  } else {
    // LAZILY, on the first message. A row created when the panel opens
    // would leave an empty chat in the history list every time somebody
    // clicked and changed their mind.
    conversationId = await startConversation(session.sub as string);
  }

  const bearer = await mintBearer(
    { sub: session.sub, email: session.email, role: session.role },
    secret,
    REFRESH_TTL_SECONDS
  );

  let upstream: Response;
  try {
    upstream = await fetch(`${agentUrl}/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-key': agentKey,
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ utterance }),
      // A dropped browser connection cancels the agent's turn, rather
      // than leaving it running with nowhere to send its events -- and,
      // more expensively, holding an MCP session open.
      signal: req.signal,
    });
  } catch {
    return fail(502, 'The assistant is unavailable');
  }

  if (!upstream.ok || !upstream.body) {
    // Deliberately opaque. What the agent said about our credentials is
    // not the browser's business.
    return fail(502, 'The assistant is unavailable');
  }

  const parser = new SseParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = upstream.body.getReader();
  const seenTurns: string[] = [];
  // The turn this stream belongs to, learned from the control frame that
  // always arrives first. An approval frame is meaningless without it:
  // there would be no session to mint against and no turn to resume.
  let openTurn: { turnId: string; sessionId: string } | null = null;
  // What the panel is being shown, kept so the same events can be written
  // down. Stored and forwarded must be one story about the turn, not two.
  const forwarded: unknown[] = [];

  function rememberIfApproval(data: string): void {
    if (!openTurn) return;

    try {
      const event = JSON.parse(data) as {
        type?: string;
        data?: { call_id?: string; tool?: string; arguments?: unknown };
      };

      if (event.type !== 'approval_required') return;

      const { call_id: callId, tool, arguments: args } = event.data ?? {};
      if (!callId || !tool) return;

      rememberApproval(callId, {
        turnId: openTurn.turnId,
        tool,
        arguments: (args ?? {}) as Record<string, unknown>,
        sessionId: openTurn.sessionId,
        userId: session!.sub as string,
      });
    } catch {
      // A frame we cannot read is one we cannot act on. Never a reason
      // to break the customer's stream.
    }
  }

  function endTurns(): void {
    // Order matters: the approvals are keyed by turn, so they go first.
    seenTurns.forEach(forgetApprovalsOf);
    seenTurns.forEach(forgetTurn);
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) {
        // The conversation is over; nothing may approve it now.
        endTurns();
        // Awaited here, where the response is still open, rather than
        // fired off afterwards -- work started after a handler returns is
        // work the runtime is free to discard.
        try {
          await appendTurn({ conversationId, utterance, events: forwarded });
        } catch (error) {
          // A turn that cannot be written is still a turn that happened.
          // The customer has read it; failing the stream now would take it
          // off their screen to report a problem they cannot act on.
          console.error('Storing an assistant turn failed:', error);
        }
        controller.close();
        return;
      }

      for (const item of parser.push(decoder.decode(value, { stream: true }))) {
        if (item.event === 'control') {
          try {
            const control = JSON.parse(item.data) as {
              turn_id?: string;
              session_id?: string;
            };
            if (control.turn_id && control.session_id) {
              rememberTurn(control.turn_id, {
                sessionId: control.session_id,
                userId: session.sub as string,
              });
              seenTurns.push(control.turn_id);
              openTurn = {
                turnId: control.turn_id,
                sessionId: control.session_id,
              };
            }
          } catch {
            // A control frame we cannot read is one we cannot act on.
            // Never a reason to break the customer's stream.
          }
          continue;
        }

        if (item.event === 'assistant') {
          // Watched on the way past, not intercepted: the customer must
          // still see WHICH action is waiting. What is kept is the part
          // the approve route may not take from a browser -- the exact
          // arguments the token will be bound to. See lib/assistant/
          // approvals.ts for why that round trip is the whole risk.
          rememberIfApproval(item.data);
          try {
            forwarded.push(JSON.parse(item.data));
          } catch {
            // Unparseable frames are dropped from the record for the same
            // reason the browser drops them: neither can act on one.
          }
          controller.enqueue(encoder.encode(frame('assistant', item.data)));
        }

        // Anything else is dropped: forwarding by exclusion means a new
        // agent-side channel cannot leak here by default.
      }
    },
    cancel() {
      endTurns();
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      // How the browser learns which conversation it is in. Not a secret --
      // it names the customer's own chat, and every route re-checks
      // ownership -- but not guessable into somebody else's either.
      'x-conversation-id': conversationId,
      // Nothing between here and the browser may buffer a stream whose
      // whole point is arriving as it happens.
      'x-accel-buffering': 'no',
    },
  });
}
