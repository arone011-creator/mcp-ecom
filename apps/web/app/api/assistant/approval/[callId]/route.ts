// app/api/assistant/approval/[callId]/route.ts
//
// The confirmation step for a high-risk tool call.
//
//   GET   what is about to happen, as the database has it
//   POST  the customer's answer
//
// THE BROWSER IS TRUSTED WITH ONE THING: which pending approval it means.
// Not the arguments, not the order's details, not the turn, not the
// agent's session. Everything else is recalled from what the bridge
// watched go past, or read fresh from the database.
//
// That is not defensiveness for its own sake. The agent's context is
// reachable by anyone who can write a product description, and the whole
// risk-tier design exists because a prompt-injected agent must not be
// able to talk its way past this step. If the token were minted for
// arguments out of a request body, it would certify whatever the caller
// claimed; if the card's facts came from the event, an injected payload
// could show one order while another was cancelled. Both are closed here
// by never asking.
//
// Cookie only, like the bridge and the refresh route. A bearer is what
// this flow ISSUES; a route that accepted one would let the agent's own
// token answer the confirmation raised on its behalf.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import prisma from '@/lib/prisma';
import { fail, ok } from '../../../v1/_lib/respond';
import { mintBearer } from '../../../v1/_lib/mint';
import { REFRESH_TTL_SECONDS } from '../../../v1/auth/refresh/route';
import {
  claimApproval,
  recallApproval,
  type PendingApproval,
} from '@/lib/assistant/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ callId: string }> };

/**
 * The approval this caller is allowed to act on, or null.
 *
 * An approval belonging to someone else answers exactly as one that does
 * not exist, for the reason the order routes give: a distinguishable
 * refusal confirms that a stranger's id is real, which is all an
 * enumeration attack needs.
 */
async function approvalFor(
  req: NextRequest,
  callId: string
): Promise<
  | { error: Response }
  | { userId: string; approval: PendingApproval; secret: string }
> {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub || !secret) {
    return { error: fail(401, 'Authentication required') };
  }

  const approval = recallApproval(callId);
  if (!approval || approval.userId !== session.sub) {
    return { error: fail(404, 'No approval is waiting') };
  }

  return { userId: session.sub as string, approval, secret };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { callId } = await params;
  const found = await approvalFor(req, callId);
  if ('error' in found) return found.error;

  const { approval, userId } = found;

  // The event named WHICH order. This answers WHAT is true about it.
  const orderId = approval.arguments.order_id;
  if (typeof orderId !== 'string') {
    return fail(422, 'That action cannot be confirmed');
  }

  try {
    // Ownership is part of the lookup rather than a check afterwards,
    // the same shape GET /api/v1/orders/[id] uses.
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        orderItems: { select: { productName: true, quantity: true } },
      },
    });

    if (!order) return fail(404, 'Order not found');

    // Assembled field by field from the row. Spreading the approval's
    // arguments in here -- or the row -- is how a claim from the event
    // would end up on the card wearing the database's authority.
    return ok({
      tool: approval.tool,
      decided: approval.decided,
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        // Passed through, never cast to a number. respond.ts renders a
        // money column as a string on purpose -- a float loses the scale,
        // and "59.90" reading as 59.9 on the one screen that asks someone
        // to confirm a real amount is the worst place for that.
        total: order.total,
        currency: order.currency,
        createdAt: order.createdAt,
        items: order.orderItems.map((item) => ({
          name: item.productName,
          quantity: item.quantity,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/assistant/approval/[callId] failed:', error);
    return fail(500, 'Failed to load the confirmation');
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { callId } = await params;
  const found = await approvalFor(req, callId);
  if ('error' in found) return found.error;

  const { approval, secret, userId } = found;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Request body must be JSON');
  }

  // Read for this and nothing else. An absent answer is not a yes.
  const approved = (body as { approved?: unknown })?.approved;
  if (typeof approved !== 'boolean') {
    return fail(400, 'A decision is required');
  }

  const agentUrl = process.env.AGENT_SERVICE_URL;
  const agentKey = process.env.AGENT_SERVICE_KEY;
  const approvalsUrl = process.env.MCP_APPROVALS_URL;

  if (!agentUrl || !agentKey || (approved && !approvalsUrl)) {
    return fail(500, 'The assistant is not configured');
  }

  // Taken once. A double-click must not mint a second token, and the
  // agent's own TurnRegistry refuses a second decision as well --
  // neither side relies on the other.
  if (!claimApproval(callId)) {
    return fail(409, 'That has already been answered');
  }

  let token: string | null = null;

  if (approved) {
    try {
      token = await mint(approval, approvalsUrl!, secret, userId);
    } catch (error) {
      console.error('Minting an approval failed:', error);
      // Nothing was approved, so nothing is spent. Handing the approval
      // back matters: the agent is still waiting, and a burnt approval
      // would leave the customer with no way to answer it.
      approval.decided = false;
      return fail(502, 'The confirmation could not be completed');
    }
  }

  try {
    const resumed = await fetch(`${agentUrl}/turn/${approval.turnId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': agentKey },
      // A decline carries no token, because none was ever minted.
      body: JSON.stringify(approved ? { approved, token } : { approved }),
    });

    if (!resumed.ok) return fail(502, 'The assistant is unavailable');
  } catch {
    return fail(502, 'The assistant is unavailable');
  }

  // Deliberately says only that the answer was delivered. WHETHER THE
  // ACTION SUCCEEDED IS NOT KNOWN YET and must not be implied: the agent
  // is only now resuming the call, and the tool_completed event on the
  // open stream is what says whether the order was actually cancelled.
  return ok({ answered: true, approved });
}

/**
 * Ask the MCP server for a token authorising this exact call.
 *
 * Every argument here comes from what the agent asked for. The bearer is
 * minted for this request and thrown away; the session id is the one the
 * paused turn is holding, because a token minted against any other
 * session is refused, which is what stops an approval crossing
 * conversations.
 */
async function mint(
  approval: PendingApproval,
  approvalsUrl: string,
  secret: string,
  userId: string
): Promise<string> {
  const bearer = await mintBearer({ sub: userId }, secret, REFRESH_TTL_SECONDS);

  const response = await fetch(approvalsUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
      'mcp-session-id': approval.sessionId,
    },
    body: JSON.stringify({ tool: approval.tool, args: approval.arguments }),
  });

  if (!response.ok) throw new Error(`Mint refused with ${response.status}`);

  const minted = (await response.json()) as { token?: unknown };
  if (typeof minted.token !== 'string' || !minted.token) {
    throw new Error('Mint returned no token');
  }

  return minted.token;
}
