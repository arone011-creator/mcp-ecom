// tests/unit/assistant-mounting.test.ts
//
// WHERE THE PROVIDER SITS IS THE FEATURE. Mounted in the root layout, a
// client-side navigation re-renders children and leaves the conversation
// and its open connection alone. Mount it inside a page instead and the
// chat resets every time the customer clicks a product.
//
// Source-level, in the style of rsc-boundaries.test.ts: this is a fact
// about the shape of the tree, and the behavioural half is the live
// check in the task's verification step.

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf-8');

describe('the assistant is mounted above the page', () => {
  it('wraps children in the root layout', () => {
    expect(layout).toContain('AssistantProvider');
    expect(layout).toContain('AssistantWidget');
  });

  it('mounts the widget outside <main>, so no page owns it', () => {
    const widgetAt = layout.indexOf('<AssistantWidget');
    const mainClosesAt = layout.indexOf('</main>');

    expect(mainClosesAt).toBeGreaterThan(-1);
    expect(widgetAt).toBeGreaterThan(mainClosesAt);
  });

  it('is mounted exactly once, and never inside a page', () => {
    // A second mount would create a second conversation that resets on
    // navigation -- exactly what mounting it once prevents.
    const hits = execSync('git grep -l "<AssistantProvider" -- app components', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    })
      .split('\n')
      .filter(Boolean)
      .sort();

    expect(hits).toEqual(['app/layout.tsx']);
  });

  it('sits inside CartProvider, so a chat-driven cart change can reach it', () => {
    // Rule 3 of the storefront plan: a cart change made through the chat
    // must invalidate the same data the header badge reads, never a
    // private copy. Nothing needs it until Task 6; the nesting is what
    // makes that possible without moving anything.
    expect(layout.indexOf('<CartProvider')).toBeLessThan(
      layout.indexOf('<AssistantProvider')
    );
  });
});
