// tests/unit/order-simulation.test.ts
//
// The ladder. A pure function of four arguments -- no database, no clock
// of its own -- so these are a table of inputs rather than a mocked clock.

import { LADDER, STEP_MS, dueStatus } from '@/lib/orders/simulation';

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
