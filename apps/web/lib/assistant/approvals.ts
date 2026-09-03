// lib/assistant/approvals.ts
//
// The high-risk calls the bridge has watched go past, waiting on a human.
//
// WHY THIS EXISTS AT ALL, since a simpler design would just let the
// browser post back what it was shown. An approval token is bound to a
// hash of the tool's arguments -- that binding is what stops approval to
// cancel one order being spent on another, and the agent-side notes call
// it "the difference between a security boundary and a convention". If
// the approve route minted for arguments out of a request body, a browser
// could ask for a token describing order A while the agent proceeds to
// cancel order B, and the binding would certify nothing.
//
// So the arguments never make the round trip. The bridge sees every
// approval_required frame on its way to the browser and records it here;
// the browser sends back a call_id and nothing else. There is no
// caller-supplied argument to distrust because there is none to supply.
//
// The turn id is kept here too, and is likewise never sent to the browser
// -- for the same reason the bridge withholds the agent's session id.
//
// In process memory, so per replica. The agent's TurnRegistry, its
// checkpointer, the approval nonce set, both rate limiters and
// turns.ts share that limitation and document it. This is another
// instance of a known constraint, not a new one.

export interface PendingApproval {
  turnId: string;
  tool: string;
  arguments: Record<string, unknown>;
  sessionId: string;
  userId: string;
  decided: boolean;
  createdAt: number;
}

// Comfortably longer than the agent's own approval wait (5 minutes), so
// an approval is never forgotten while someone is still deciding.
const APPROVAL_TTL_MS = 15 * 60 * 1000;

const pending = new Map<string, PendingApproval>();

export function rememberApproval(
  callId: string,
  details: {
    turnId: string;
    tool: string;
    arguments: Record<string, unknown>;
    sessionId: string;
    userId: string;
  }
): void {
  pending.set(callId, { ...details, decided: false, createdAt: Date.now() });
}

export function recallApproval(callId: string): PendingApproval | null {
  // Swept on read rather than on a timer, like turns.ts: a serverless-ish
  // runtime may never run a timer, and this costs nothing on a map this
  // small.
  sweepApprovals(Date.now());
  return pending.get(callId) ?? null;
}

/**
 * Take this approval, once.
 *
 * Returns the approval on the first call and null on every call after,
 * so a double-click cannot mint a second token. Marked rather than
 * deleted, because "you already decided this" and "that expired" are
 * different things to tell someone.
 */
export function claimApproval(callId: string): PendingApproval | null {
  const approval = recallApproval(callId);
  if (!approval || approval.decided) return null;

  approval.decided = true;
  return approval;
}

export function forgetApprovalsOf(turnId: string): void {
  for (const [callId, approval] of pending) {
    if (approval.turnId === turnId) pending.delete(callId);
  }
}

export function sweepApprovals(now: number): void {
  for (const [callId, approval] of pending) {
    if (now - approval.createdAt >= APPROVAL_TTL_MS) pending.delete(callId);
  }
}

/** Test seam. */
export function resetApprovals(): void {
  pending.clear();
}
