// tests/integration/advance-simulation.test.ts
//
// The write. lib/orders/simulation.ts decides WHAT is due; this decides
// how it is written, and the only interesting thing about it is that two
// readers racing must not advance the same order twice.

const mockPrisma = {
  order: { updateMany: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

import {
  advanceAllDue,
  advanceIfDue,
} from '@/server/orders/advance-simulation';

const START = new Date('2026-09-05T12:00:00.000Z');
const LATER = new Date('2026-09-05T12:02:30.000Z');

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord_1',
    status: 'PENDING',
    simulationStartedAt: START,
    simulationPausedAt: null,
    shippedAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockPrisma.order.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('advanceIfDue', () => {
  it('writes the status the order is due', async () => {
    await advanceIfDue(order(), LATER);

    expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SHIPPED' }),
      })
    );
  });

  it('writes nothing when nothing is due', async () => {
    await advanceIfDue(order(), START);

    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing for an order with no clock', async () => {
    // THE MUST PROVE, at the layer that actually touches the database.
    await advanceIfDue(order({ simulationStartedAt: null }), LATER);

    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing for a cancelled order', async () => {
    await advanceIfDue(order({ status: 'CANCELLED' }), LATER);

    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('guards the write with the status it read', async () => {
    // A COMPARE-AND-SET. Two readers racing both compute SHIPPED; the
    // second matches no row, because the first already moved it off
    // PENDING. Without this, a burst of reads could double-advance.
    await advanceIfDue(order(), LATER);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.where).toEqual({ id: 'ord_1', status: 'PENDING' });
  });

  it('stamps shippedAt when it ships', async () => {
    // The column already exists and nothing has ever set it.
    await advanceIfDue(order(), LATER);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.data.shippedAt).toEqual(LATER);
    expect(args.data.deliveredAt).toBeUndefined();
  });

  it('stamps deliveredAt when it is delivered', async () => {
    const muchLater = new Date(START.getTime() + 10 * 60_000);
    await advanceIfDue(order(), muchLater);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.data.status).toBe('DELIVERED');
    expect(args.data.deliveredAt).toEqual(muchLater);
  });

  it('does not restamp a timestamp the order already has', async () => {
    const already = new Date('2026-09-05T11:00:00.000Z');
    const muchLater = new Date(START.getTime() + 10 * 60_000);

    await advanceIfDue(order({ deliveredAt: already }), muchLater);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.data.deliveredAt).toBeUndefined();
  });

  it('answers with the advanced order so the caller renders it fresh', async () => {
    // Rather than making the caller re-read. A page that rendered the row
    // it read a moment before the write would show the customer a status
    // one step behind the database.
    const advanced = await advanceIfDue(order(), LATER);

    expect(advanced.status).toBe('SHIPPED');
  });

  it('answers with the original order when nothing was due', async () => {
    const untouched = order();

    expect(await advanceIfDue(untouched, START)).toBe(untouched);
  });

  it('does not fail a read when the write fails', async () => {
    // A READ MUST NOT DIE BECAUSE A COSMETIC WRITE DID. The customer is
    // looking at their order; a failed simulation tick is not a reason to
    // show them an error page.
    mockPrisma.order.updateMany.mockRejectedValue(new Error('db is gone'));

    const result = await advanceIfDue(order(), LATER);

    expect(result.status).toBe('PENDING');
  });
});

describe('advanceAllDue', () => {
  it('advances each order that is due and leaves the rest alone', async () => {
    const rows = [
      order({ id: 'a' }),
      order({ id: 'b', simulationStartedAt: null }),
      order({ id: 'c', status: 'CANCELLED' }),
    ];

    const advanced = await advanceAllDue(rows, LATER);

    expect(advanced.map((o) => o.status)).toEqual([
      'SHIPPED',
      'PENDING',
      'CANCELLED',
    ]);
    expect(mockPrisma.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the order of the list it was given', async () => {
    const rows = [order({ id: 'a' }), order({ id: 'b' })];

    expect((await advanceAllDue(rows, LATER)).map((o) => o.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('writes nothing for an empty list', async () => {
    expect(await advanceAllDue([], LATER)).toEqual([]);
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });
});
