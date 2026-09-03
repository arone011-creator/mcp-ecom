// tests/unit/assistant-approvals.test.ts
//
// What the bridge saw go past, kept so the approve route can act on it
// without asking the browser.
//
// THE POINT OF THIS MODULE IS WHAT IT MAKES IMPOSSIBLE. The approve route
// mints a token bound to a hash of the tool arguments. If those arguments
// came from the request body, a browser could ask for a token for one
// order and spend it on another, and the whole approval binding would be
// decoration. Because they are recalled from here by call_id, there is no
// caller-supplied argument to ignore in the first place.

import {
  claimApproval,
  forgetApprovalsOf,
  rememberApproval,
  recallApproval,
  resetApprovals,
  sweepApprovals,
} from '@/lib/assistant/approvals';

const PENDING = {
  turnId: 't1',
  tool: 'cancel_order',
  arguments: { order_id: 'ord_9' },
  sessionId: 'sess-1',
  userId: 'user-1',
};

beforeEach(() => resetApprovals());

describe('pending approvals', () => {
  it('remembers what the event said, so the route never has to be told', () => {
    rememberApproval('c1', PENDING);

    expect(recallApproval('c1')).toMatchObject({
      turnId: 't1',
      tool: 'cancel_order',
      arguments: { order_id: 'ord_9' },
      sessionId: 'sess-1',
      userId: 'user-1',
    });
  });

  it('knows nothing about a call_id it never saw', () => {
    expect(recallApproval('made-up')).toBeNull();
  });

  it('lets the first claim through and refuses the second', () => {
    // A double-click must not mint two approvals. The agent's own
    // TurnRegistry refuses a second decision too; neither side may rely
    // on the other.
    rememberApproval('c1', PENDING);

    expect(claimApproval('c1')).not.toBeNull();
    expect(claimApproval('c1')).toBeNull();
  });

  it('still recalls a claimed approval, so the card can say it was decided', () => {
    // Deleting on claim would make an already-decided approval
    // indistinguishable from one that expired, and those are different
    // things to tell someone.
    rememberApproval('c1', PENDING);
    claimApproval('c1');

    expect(recallApproval('c1')?.decided).toBe(true);
  });

  it('forgets everything belonging to a turn when the turn ends', () => {
    // The conversation is over; nothing may approve it now. Same rule the
    // bridge already applies to remembered turns.
    rememberApproval('c1', PENDING);
    rememberApproval('c2', { ...PENDING, turnId: 't2' });

    forgetApprovalsOf('t1');

    expect(recallApproval('c1')).toBeNull();
    expect(recallApproval('c2')).not.toBeNull();
  });

  it('expires, so an abandoned tab cannot approve an hour later', () => {
    rememberApproval('c1', PENDING);

    sweepApprovals(Date.now() + 16 * 60 * 1000);

    expect(recallApproval('c1')).toBeNull();
  });

  it('holds no credential of any kind', () => {
    // This map outlives a request. The session id it holds is the agent's
    // MCP session -- needed to mint against the right conversation -- and
    // a bearer here would be a stored credential with a fifteen minute
    // life and no owner.
    rememberApproval('c1', PENDING);

    const serialised = JSON.stringify(recallApproval('c1')).toLowerCase();
    expect(serialised).not.toContain('bearer');
    expect(serialised).not.toContain('authorization');
    expect(serialised).not.toContain('token');
  });
});
