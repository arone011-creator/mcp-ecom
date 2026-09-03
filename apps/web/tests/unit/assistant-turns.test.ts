// tests/unit/assistant-turns.test.ts
//
// The control frame arrives once, mid-stream, and Task 5's approve route
// needs both of its fields afterwards. Discarding them means re-plumbing
// the bridge later.
//
// Storing the customer's bearer would mean holding a credential we do
// not need: the person clicking approve is the same signed-in browser
// and can mint their own from their own cookie. So the shape has no room
// for one, and a test says so.

import {
  forgetTurn,
  rememberTurn,
  recallTurn,
  sweepTurns,
} from '@/lib/assistant/turns';

describe('the turn store', () => {
  it('remembers what the approve route will need', () => {
    rememberTurn('turn_1', { sessionId: 'sess_1', userId: 'user_1' });

    expect(recallTurn('turn_1')).toMatchObject({
      sessionId: 'sess_1',
      userId: 'user_1',
    });
  });

  it('knows nothing about a turn it never saw', () => {
    expect(recallTurn('never')).toBeNull();
  });

  it('never stores a bearer token', () => {
    // Asserted structurally, so a future caller cannot quietly start
    // putting one there.
    rememberTurn('turn_2', { sessionId: 's', userId: 'u' });

    expect(Object.keys(recallTurn('turn_2') as object).sort()).toEqual([
      'createdAt',
      'sessionId',
      'userId',
    ]);
  });

  it('forgets a turn when it ends', () => {
    rememberTurn('turn_3', { sessionId: 's', userId: 'u' });
    forgetTurn('turn_3');

    expect(recallTurn('turn_3')).toBeNull();
  });

  it('forgets a turn nobody ever finished', () => {
    // A store that only grows is a leak with a slow fuse -- the same
    // reasoning as the agent's own TurnRegistry.
    rememberTurn('turn_4', { sessionId: 's', userId: 'u' });
    sweepTurns(Date.now() + 60 * 60 * 1000);

    expect(recallTurn('turn_4')).toBeNull();
  });

  it('keeps a turn that is still young', () => {
    rememberTurn('turn_5', { sessionId: 's', userId: 'u' });
    sweepTurns(Date.now());

    expect(recallTurn('turn_5')).not.toBeNull();
  });
});
