// tests/unit/assistant-events.test.ts
//
// The TypeScript half of the assistant event contract. The schema was
// frozen in the agent repository (mcp-ecom-agent-layer/contracts/
// README.md); this side implements it and is held to it by the same
// golden stream, so a shape change on either side turns one of the two
// suites red rather than surfacing as a broken chat window.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  OUT_OF_BAND,
  parseEvent,
  replay,
  SCHEMA_VERSION,
} from '@/lib/assistant/events';

const FIXTURE_PATH = join(__dirname, '../../lib/assistant/assistant-events.v1.json');

describe('the vendored golden stream', () => {
  it('is present and is version 1', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

    expect(fixture.version).toBe(1);
    expect(fixture.events.length).toBeGreaterThan(0);
  });

  it('covers every event type, so none can drift unnoticed', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    const types = new Set(fixture.events.map((e: any) => e.type));

    expect(types).toEqual(
      new Set([
        'message',
        'message_delta',
        'tool_started',
        'tool_completed',
        'approval_required',
        'error',
      ])
    );
  });

  it('is byte-identical to the agent repository when both are checked out', () => {
    // Copied, never adapted: the two repositories hold the same bytes so
    // a diff between them is a real signal. Skipped rather than failed
    // when the sibling repo is absent -- CI here has no reason to have
    // it -- and it says which of the two happened.
    const original = join(
      __dirname,
      '../../../../../mcp-ecom-agent-layer/contracts/assistant-events.v1.json'
    );

    if (!existsSync(original)) {
      console.warn(
        'agent repo not checked out beside this one; cross-repo byte check not run'
      );
      return;
    }

    expect(readFileSync(FIXTURE_PATH, 'utf-8')).toBe(readFileSync(original, 'utf-8'));
  });
});

describe('parseEvent', () => {
  const good = { v: 1, seq: 0, type: 'message', data: { text: 'hello' } };

  it('accepts a well-formed event', () => {
    expect(parseEvent(good)).toEqual(good);
  });

  it('accepts a type it has never heard of', () => {
    // Forward compatibility in the direction that actually happens: a
    // newer agent deployed against an older UI must not break it.
    const future = { v: 1, seq: 1, type: 'thinking_started', data: {} };

    expect(parseEvent(future)).toEqual(future);
  });

  // The MUST PROVE. Each of these would otherwise throw mid-stream and
  // leave the customer with half a conversation and no way forward.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not an event'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['a future schema version', { v: 2, seq: 0, type: 'message', data: {} }],
    ['a missing seq', { v: 1, type: 'message', data: {} }],
    ['a non-numeric seq', { v: 1, seq: 'first', type: 'message', data: {} }],
    ['a fractional seq', { v: 1, seq: 1.5, type: 'message', data: {} }],
    ['a missing type', { v: 1, seq: 0, data: {} }],
    ['an empty type', { v: 1, seq: 0, type: '', data: {} }],
    ['a non-object data', { v: 1, seq: 0, type: 'message', data: 'text' }],
    ['a missing data', { v: 1, seq: 0, type: 'message' }],
  ])('drops %s rather than throwing', (_label, input) => {
    expect(() => parseEvent(input)).not.toThrow();
    expect(parseEvent(input)).toBeNull();
  });

  it('exports the version it implements', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('accepts every event in the golden stream', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

    expect(fixture.events.map(parseEvent).filter(Boolean)).toHaveLength(
      fixture.events.length
    );
  });
});

describe('replay', () => {
  it('reaches the conversation the golden stream documents', () => {
    // The cross-repository anchor. The agent repo asserts the same file
    // reduces to the same `expected` in Python. If either side changes
    // shape, one of the two suites fails -- the whole mechanism.
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

    expect(replay(fixture.events)).toEqual(fixture.expected);
  });

  it('lists an approved call once, not twice', () => {
    // approval_required and the tool_started that follows an approval
    // carry the SAME call_id -- one call, approved and then run. Listing
    // it twice draws two chips for one cancellation. This was a real bug
    // in the Python reducer, caught only by the live approval gate; the
    // port should not have to rediscover it.
    const events = [
      { v: 1, seq: 0, type: 'approval_required', data: { call_id: 'c1', tool: 'cancel_order', arguments: { order_id: 'o1' } } },
      { v: 1, seq: 1, type: 'tool_started', data: { call_id: 'c1', tool: 'cancel_order', arguments: { order_id: 'o1' } } },
      { v: 1, seq: 2, type: 'tool_completed', data: { call_id: 'c1', tool: 'cancel_order', ok: true, result: { status: 'CANCELLED' } } },
    ] as any;

    const tools = replay(events).tools;

    expect(tools).toHaveLength(1);
    expect(tools[0].ok).toBe(true);
    expect(tools[0].awaiting_approval).toBeUndefined();
  });

  it('leaves a still-pending approval marked as waiting', () => {
    const events = [
      { v: 1, seq: 0, type: 'approval_required', data: { call_id: 'c1', tool: 'cancel_order', arguments: { order_id: 'o1' } } },
    ] as any;

    expect(replay(events).tools[0].awaiting_approval).toBe(true);
  });

  it('ignores an event type it does not know', () => {
    const events = [
      { v: 1, seq: 0, type: 'message', data: { text: 'hi' } },
      { v: 1, seq: 1, type: 'thinking_started', data: {} },
      { v: 1, seq: 2, type: 'message', data: { text: 'bye' } },
    ] as any;

    expect(replay(events).text).toEqual(['hi', 'bye']);
  });

  it('reports a gap rather than hiding it', () => {
    // A dropped event means the screen is not showing what happened,
    // and silence would be the worse failure.
    const events = [
      { v: 1, seq: 0, type: 'message', data: { text: 'hi' } },
      { v: 1, seq: 2, type: 'message', data: { text: 'bye' } },
    ] as any;

    expect(replay(events).gaps).toEqual([1]);
  });

  it('pairs a failed tool with its start and keeps the message verbatim', () => {
    const events = [
      { v: 1, seq: 0, type: 'tool_started', data: { call_id: 'c1', tool: 'add_to_cart', arguments: { quantity: 57 } } },
      { v: 1, seq: 1, type: 'tool_completed', data: { call_id: 'c1', tool: 'add_to_cart', ok: false, error: '409: Only 17 available' } },
    ] as any;

    const tool = replay(events).tools[0];

    expect(tool.ok).toBe(false);
    expect(tool.arguments).toEqual({ quantity: 57 });
    expect(tool.error).toContain('Only 17 available');
  });

  it('records a completion whose start was never seen', () => {
    // Half a pair is a symptom worth showing, not one worth swallowing.
    const events = [
      { v: 1, seq: 0, type: 'tool_completed', data: { call_id: 'c1', tool: 'get_cart', ok: true, result: { itemCount: 0 } } },
    ] as any;

    expect(replay(events).tools[0].tool).toBe('get_cart');
  });

  it('survives an empty stream', () => {
    expect(replay([])).toEqual({
      text: [],
      tools: [],
      errors: [],
      gaps: [],
      timeline: [],
    });
  });
});

describe('replay of partial text', () => {
  const delta = (text: string) =>
    ({ v: 1, seq: OUT_OF_BAND, type: 'message_delta', data: { text } }) as any;
  const msg = (seq: number, text: string) =>
    ({ v: 1, seq, type: 'message', data: { text } }) as any;

  it('accumulates fragments so the answer can be watched arriving', () => {
    expect(replay([delta('Your most '), delta('recent order.')]).text).toEqual([
      'Your most recent order.',
    ]);
  });

  it('lets the authoritative message replace the fragments, not join them', () => {
    // Without this the customer reads the answer twice. The message is
    // also the redacted one -- the fragments are redacted chunk by chunk
    // and the message over the whole answer -- so where the two differ,
    // the message is the one that must survive.
    const events = [
      delta('Visit https://evil.example.com/x'),
      msg(0, 'Visit [link removed]'),
    ];

    expect(replay(events).text).toEqual(['Visit [link removed]']);
  });

  it('keeps an unfinished run rather than erasing what was read', () => {
    const events = [msg(0, 'Looking that up.'), delta('Anything else'), delta('?')];

    expect(replay(events).text).toEqual(['Looking that up.', 'Anything else?']);
  });

  it('pairs two runs with their own messages, in order', () => {
    const events = [delta('first'), msg(0, 'first'), delta('second'), msg(1, 'second')];

    expect(replay(events).text).toEqual(['first', 'second']);
  });

  it('does not count an out-of-band event when looking for gaps', () => {
    // seq -1 means "not part of the numbered record". Counted, it drags
    // the low end of the range down and invents gaps that never happened.
    expect(replay([delta('hi'), msg(3, 'hi')]).gaps).toEqual([]);
  });

  it('is accepted by parseEvent despite its negative seq', () => {
    // The parser guards the door. A delta it rejected would never reach
    // the reducer above, and every test here would be theatre.
    expect(parseEvent(delta('hi'))).not.toBeNull();
  });
});

describe('replay ordering', () => {
  const msg = (seq: number, text: string) =>
    ({ v: 1, seq, type: 'message', data: { text } }) as any;
  const delta = (text: string) =>
    ({ v: 1, seq: OUT_OF_BAND, type: 'message_delta', data: { text } }) as any;
  const started = (seq: number, callId: string) =>
    ({
      v: 1,
      seq,
      type: 'tool_started',
      data: { call_id: callId, tool: 'get_orders', arguments: {} },
    }) as any;

  it('keeps prose and tools in the order they happened', () => {
    // The bug this exists for: three parallel lists cannot say what came
    // before what, so the panel grouped all questions, then all chips,
    // then all answers.
    const events = [
      msg(0, 'Let me look.'),
      started(1, 'c1'),
      msg(2, 'You ordered ORD-1.'),
    ];

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Let me look.' },
      { kind: 'tool', call_id: 'c1' },
      { kind: 'text', text: 'You ordered ORD-1.' },
    ]);
  });

  it('lists one call once, however many events it emits', () => {
    const events = [
      {
        v: 1,
        seq: 0,
        type: 'approval_required',
        data: { call_id: 'c1', tool: 'cancel_order', arguments: {} },
      },
      started(1, 'c1'),
      {
        v: 1,
        seq: 2,
        type: 'tool_completed',
        data: { call_id: 'c1', tool: 'cancel_order', ok: true, result: {} },
      },
    ] as any;

    expect(replay(events).timeline).toEqual([{ kind: 'tool', call_id: 'c1' }]);
  });

  it('names a tool rather than embedding it', () => {
    // A tool's state changes after it appears. An embedded snapshot would
    // be captured as "working" and stay that way forever.
    const events = [
      started(0, 'c1'),
      {
        v: 1,
        seq: 1,
        type: 'tool_completed',
        data: { call_id: 'c1', tool: 'get_orders', ok: true, result: [] },
      },
    ] as any;

    const conversation = replay(events);

    expect(conversation.timeline).toEqual([{ kind: 'tool', call_id: 'c1' }]);
    expect(conversation.tools[0].ok).toBe(true);
  });

  it('finalises a run of fragments in place, keeping its position', () => {
    const events = [
      delta('Visit https://evil.example.com/x'),
      started(0, 'c1'),
      msg(1, 'Visit [link removed]'),
    ];

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Visit https://evil.example.com/x' },
      { kind: 'tool', call_id: 'c1' },
      { kind: 'text', text: 'Visit [link removed]' },
    ]);
  });

  it('closes an open run of fragments when a tool intervenes', () => {
    const events = [delta('Checking'), started(0, 'c1'), delta('Found it')];

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Checking' },
      { kind: 'tool', call_id: 'c1' },
      { kind: 'text', text: 'Found it' },
    ]);
  });

  it('gives a turn failure its place in the order', () => {
    const events = [
      msg(0, 'Looking that up.'),
      {
        v: 1,
        seq: 1,
        type: 'error',
        data: { message: 'Could not reach the shop.', retryable: true },
      },
    ] as any;

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Looking that up.' },
      { kind: 'error', message: 'Could not reach the shop.', retryable: true },
    ]);
  });

  it('has an empty timeline for an empty stream', () => {
    expect(replay([]).timeline).toEqual([]);
  });
});
