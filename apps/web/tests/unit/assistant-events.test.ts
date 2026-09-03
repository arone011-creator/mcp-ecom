// tests/unit/assistant-events.test.ts
//
// The TypeScript half of the assistant event contract. The schema was
// frozen in the agent repository (mcp-ecom-agent-layer/contracts/
// README.md); this side implements it and is held to it by the same
// golden stream, so a shape change on either side turns one of the two
// suites red rather than surfacing as a broken chat window.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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
