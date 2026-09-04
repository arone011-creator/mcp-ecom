// tests/unit/order-simulation.test.ts
//
// The ladder. A pure function of four arguments -- no database, no clock
// of its own -- so these are a table of inputs rather than a mocked clock.

import {
  LADDER,
  STEP_MS,
  dueStatus,
  formatCountdown,
  isTerminated,
  msUntilNextStep,
} from '@/lib/orders/simulation';

const START = new Date('2026-09-05T12:00:00.000Z');

/** `minutes` after the clock started. */
function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

describe('dueStatus', () => {
  it('advances one step a minute', () => {
    expect(dueStatus('PENDING', START, null, at(0))).toBeNull();
    expect(dueStatus('PENDING', START, null, at(1))).toBe('PROCESSING');
    expect(dueStatus('PENDING', START, null, at(2))).toBe('SHIPPED');
    expect(dueStatus('PENDING', START, null, at(3))).toBe('DELIVERED');
  });

  it('does not advance before the minute is up', () => {
    expect(dueStatus('PENDING', START, null, at(0.99))).toBeNull();
  });

  it('goes straight to the right step after a long absence', () => {
    // Ten minutes away lands on DELIVERED in ONE write, not three. A loop
    // that stepped once per read would take three page loads to catch up.
    expect(dueStatus('PENDING', START, null, at(10))).toBe('DELIVERED');
  });

  it('never advances past the end of the ladder', () => {
    expect(dueStatus('DELIVERED', START, null, at(99))).toBeNull();
  });

  it('reports nothing when the order is already where it should be', () => {
    expect(dueStatus('PROCESSING', START, null, at(1))).toBeNull();
    expect(dueStatus('SHIPPED', START, null, at(2))).toBeNull();
  });

  it('never moves an order backwards', () => {
    // An order ahead of its clock -- however that happened -- is left
    // alone. Rewinding a customer's order is worse than a stale one.
    expect(dueStatus('SHIPPED', START, null, at(1))).toBeNull();
    expect(dueStatus('DELIVERED', START, null, at(0))).toBeNull();
  });

  it('never advances an order with no clock', () => {
    // THE MUST PROVE. This is what protects every row that existed before
    // this feature shipped.
    expect(dueStatus('PENDING', null, null, at(999))).toBeNull();
  });

  it('never advances a cancelled order', () => {
    // And so can never un-cancel one.
    expect(dueStatus('CANCELLED', START, null, at(99))).toBeNull();
  });

  it('never advances a refunded order', () => {
    expect(dueStatus('REFUNDED', START, null, at(99))).toBeNull();
  });

  it('never advances an order in CONFIRMED', () => {
    // CONFIRMED is not on the ladder and nothing produces it. An order
    // that somehow holds it is left alone rather than guessed about.
    expect(dueStatus('CONFIRMED', START, null, at(99))).toBeNull();
  });

  it('freezes time while paused', () => {
    // THE MUST PROVE. Paused at 30 seconds, read an hour later: still not
    // due, because the clock stopped when the pause started.
    const pausedAt = at(0.5);

    expect(dueStatus('PENDING', START, pausedAt, at(60))).toBeNull();
  });

  it('reports what was already due at the moment of the pause', () => {
    // Pausing does not roll anything back. If a step was owed before the
    // pause, it is still owed after it.
    const pausedAt = at(2);

    expect(dueStatus('PENDING', START, pausedAt, at(60))).toBe('SHIPPED');
  });

  it('describes the ladder the tracker draws', () => {
    // Four states, matching the four dots on the order page. CONFIRMED is
    // absent on purpose -- lib/validators.ts omits it too, and an order
    // sitting in it renders identically to PENDING.
    expect(LADDER).toEqual(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
  });

  it('steps once a minute', () => {
    expect(STEP_MS).toBe(60_000);
  });
});

describe('isTerminated', () => {
  // The order page draws its four-step tracker for anything that is NOT
  // terminated. Before this branch existed, a CANCELLED order rendered
  // identically to a PENDING one -- first dot green, three grey -- which
  // told the customer their cancelled order was on its way.
  //
  // This function exists because a mutation found that gap: removing the
  // branch broke no test, since the page is a server component with no
  // harness. The decision is testable even where the rendering is not.

  it('is true for an order that was cancelled', () => {
    expect(isTerminated('CANCELLED')).toBe(true);
  });

  it('is true for an order that was refunded', () => {
    expect(isTerminated('REFUNDED')).toBe(true);
  });

  it('is false for an order that is still on its way', () => {
    expect(isTerminated('PENDING')).toBe(false);
    expect(isTerminated('PROCESSING')).toBe(false);
    expect(isTerminated('SHIPPED')).toBe(false);
  });

  it('is false for a delivered order, which arrived rather than ended', () => {
    // DELIVERED is the end of the ladder, so the tracker should show it
    // complete rather than replacing it with a notice.
    expect(isTerminated('DELIVERED')).toBe(false);
  });
});

describe('msUntilNextStep', () => {
  // The countdown the demo panel shows. Same four arguments as dueStatus
  // and the same rules, answering "how long" instead of "what next" -- so
  // the number on screen and the status that eventually lands are read off
  // the same clock rather than two that can drift apart.

  it('counts down to the next step', () => {
    expect(msUntilNextStep('PENDING', START, null, at(0))).toBe(60_000);
    expect(msUntilNextStep('PENDING', START, null, at(0.5))).toBe(30_000);
    expect(msUntilNextStep('PENDING', START, null, at(0.75))).toBe(15_000);
  });

  it('counts to the step after the one already reached', () => {
    // An order that has advanced to PROCESSING is a minute into its clock,
    // so it is a further minute from SHIPPED -- not two minutes.
    expect(msUntilNextStep('PROCESSING', START, null, at(1))).toBe(60_000);
    expect(msUntilNextStep('SHIPPED', START, null, at(2.5))).toBe(30_000);
  });

  it('reaches zero, and never goes below it', () => {
    // Zero means "due now". The status is written on the next read, so
    // there is a moment between owing a step and having taken it, and a
    // countdown showing minus four seconds would be describing that gap
    // as if something were wrong.
    expect(msUntilNextStep('PENDING', START, null, at(1))).toBe(0);
    expect(msUntilNextStep('PENDING', START, null, at(10))).toBe(0);
  });

  it('freezes while paused', () => {
    // THE MUST PROVE. Paused with fifteen seconds to go, read an hour
    // later: still fifteen seconds to go. A countdown that kept running
    // while the order could not move would be lying about both.
    const pausedAt = at(0.75);

    expect(msUntilNextStep('PENDING', START, pausedAt, at(60))).toBe(15_000);
  });

  it('has nothing to count for an order with no clock', () => {
    expect(msUntilNextStep('PENDING', null, null, at(999))).toBeNull();
  });

  it('has nothing to count at the end of the ladder', () => {
    expect(msUntilNextStep('DELIVERED', START, null, at(0))).toBeNull();
  });

  it('has nothing to count for an order that ended', () => {
    expect(msUntilNextStep('CANCELLED', START, null, at(0))).toBeNull();
    expect(msUntilNextStep('REFUNDED', START, null, at(0))).toBeNull();
  });

  it('agrees with dueStatus about whether a step is owed', () => {
    // The two functions must not disagree: whenever the countdown says
    // zero, dueStatus must have something to write, and whenever it says
    // more than zero, dueStatus must have nothing.
    for (const minutes of [0, 0.5, 0.99, 1, 1.5, 2, 2.99, 3, 10]) {
      const remaining = msUntilNextStep('PENDING', START, null, at(minutes));
      const due = dueStatus('PENDING', START, null, at(minutes));

      expect(remaining === 0).toBe(due !== null);
    }
  });
});

describe('formatCountdown', () => {
  it('reads as minutes and padded seconds', () => {
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(45_000)).toBe('0:45');
    expect(formatCountdown(9_000)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('rounds up, so it shows 0:00 only when the step is actually due', () => {
    // Rounding down would put "0:00" on screen for a whole second while
    // the order was still waiting, which reads as stuck.
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(999)).toBe('0:01');
    expect(formatCountdown(59_001)).toBe('1:00');
  });

  it('never shows a negative time', () => {
    expect(formatCountdown(-5_000)).toBe('0:00');
  });
});
