// tests/unit/assistant-events.test.ts
//
// The TypeScript half of the assistant event contract. The schema was
// frozen in the agent repository (mcp-ecom-agent-layer/contracts/
// README.md); this side implements it and is held to it by the same
// golden stream, so a shape change on either side turns one of the two
// suites red rather than surfacing as a broken chat window.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { parseEvent, replay, SCHEMA_VERSION } from '@/lib/assistant/events';

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
    expect(replay([])).toEqual({ text: [], tools: [], errors: [], gaps: [] });
  });
});
