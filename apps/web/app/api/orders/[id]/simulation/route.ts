// app/api/orders/[id]/simulation/route.ts
//
// POST -- pause or resume one order's simulated lifecycle.
//
// DELIBERATELY NOT UNDER /api/v1. That surface is documented as the entire
// set of capabilities the AI layer may use, and freezing a demo clock is
// not one of them. Cookie-authenticated like the assistant routes, which
// means the agent -- which carries a bearer and no cookie -- structurally
// cannot reach this, rather than being trusted not to.
//
// RESUMING PUSHES THE START FORWARD by however long the pause lasted,
// rather than accumulating a debt in a third column. Elapsed time then has
// exactly one representation instead of two that can disagree.
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import prisma from '@/lib/prisma';
import { fail, ok } from '../../../v1/_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Request body must be JSON');
  }

  const action = (body as { action?: unknown })?.action;
  if (action !== 'pause' && action !== 'resume') {
    return fail(400, 'Action must be pause or resume');
  }

  // Ownership inside the query, and a 404 for a stranger's id rather than
  // a 403 -- the same rule every other order route follows, because a
  // distinguishable refusal confirms the id is real.
  const order = await prisma.order.findFirst({
    where: { id, userId: session.sub as string },
    select: { id: true, simulationStartedAt: true, simulationPausedAt: true },
  });

  if (!order) return fail(404, 'Order not found');

  // Nothing to pause on an order with no clock -- every order that
  // predates this feature. Not an error: the caller asked for a state it
  // is already in.
  if (!order.simulationStartedAt) return ok({ paused: false });

  const now = new Date();

  if (action === 'pause') {
    // Idempotent: already paused is already the answer.
    if (!order.simulationPausedAt) {
      await prisma.order.update({
        where: { id: order.id },
        data: { simulationPausedAt: now },
      });
    }

    return ok({ paused: true });
  }

  if (order.simulationPausedAt) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        // The whole of the pause, given back. Without this the order
        // would leap forward by however long it sat paused, which is the
        // opposite of what pausing is for.
        simulationStartedAt: new Date(
          order.simulationStartedAt.getTime() +
            (now.getTime() - order.simulationPausedAt.getTime())
        ),
        simulationPausedAt: null,
      },
    });
  }

  return ok({ paused: false });
}
