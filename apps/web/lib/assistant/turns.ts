// lib/assistant/turns.ts
//
// What the bridge learned from a `control` frame and the approve route
// will need afterwards.
//
// The frame arrives once, mid-stream, carrying the agent's turn id and
// the MCP session id an approval must be minted against. Neither can be
// recovered later, so they are kept here rather than dropped.
//
// DELIBERATELY NOT THE CUSTOMER'S BEARER. The person clicking approve is
// the same signed-in browser, so that route mints its own token from its
// own cookie. `userId` is here so it can refuse an approval from a
// different customer -- an identity check, not a credential.
//
// In process memory, so per replica. The agent's TurnRegistry, the
// approval nonce set and both rate limiters share that limitation and
// document it; this is a fourth instance of a known constraint, not a
// new one.

export interface RememberedTurn {
  sessionId: string;
  userId: string;
  createdAt: number;
}

// Comfortably longer than the agent's own approval wait, so a turn is
// never forgotten while someone is still deciding.
const TURN_TTL_MS = 15 * 60 * 1000;

const turns = new Map<string, RememberedTurn>();

export function rememberTurn(
  turnId: string,
  details: { sessionId: string; userId: string }
): void {
  turns.set(turnId, { ...details, createdAt: Date.now() });
}

export function recallTurn(turnId: string): RememberedTurn | null {
  // Swept on read rather than on a timer: a serverless-ish runtime may
  // never run a timer, and this costs nothing on a map this small.
  sweepTurns(Date.now());
  return turns.get(turnId) ?? null;
}

export function forgetTurn(turnId: string): void {
  turns.delete(turnId);
}

export function sweepTurns(now: number): void {
  for (const [turnId, turn] of turns) {
    if (now - turn.createdAt >= TURN_TTL_MS) turns.delete(turnId);
  }
}
