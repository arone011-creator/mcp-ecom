// tests/unit/smooth-scroll.test.ts
//
// The panel animates its own scrolling rather than asking the browser to.
// Measured against the deployed build in Chrome: behavior:'smooth' on
// scrollIntoView, behavior:'smooth' on scrollTo, and CSS scroll-behavior
// all moved this container by exactly nothing, while a plain assignment
// moved it correctly. So the tween is ours, and being ours it can be
// tested frame by frame instead of taken on trust.

import { animateScrollTop, easeOutCubic } from '@/lib/assistant/smooth-scroll';

describe('easeOutCubic', () => {
  it('starts at the start and ends at the end', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('only ever moves forward', () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeOutCubic(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('decelerates: it covers more ground early than late', () => {
    // This is what makes it read as motion rather than as a jump. A
    // linear ramp would pass every test above and look wrong.
    const firstHalf = easeOutCubic(0.5) - easeOutCubic(0);
    const secondHalf = easeOutCubic(1) - easeOutCubic(0.5);

    expect(firstHalf).toBeGreaterThan(secondHalf);
  });

  it('clamps anything outside the interval', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

/** A scroll container and a hand-cranked clock, so frames are ours to step. */
function harness(startAt = 0) {
  const element = { scrollTop: startAt } as { scrollTop: number };
  const frames: Array<() => void> = [];
  let clock = 0;

  return {
    element,
    positions: [] as number[],
    /** Run one frame, `ms` after the previous one. */
    step(ms: number) {
      clock += ms;
      const due = frames.shift();
      due?.();
    },
    options: {
      clock: () => clock,
      schedule: (callback: () => void) => {
        frames.push(callback);
      },
    },
    pending: () => frames.length,
  };
}

describe('animateScrollTop', () => {
  it('does not jump straight to the destination', () => {
    // THE WHOLE POINT. The previous build assigned the final position in
    // one go and the message simply appeared at the top.
    const h = harness(0);

    animateScrollTop(h.element, 1000, { duration: 300, ...h.options });
    h.step(50);

    expect(h.element.scrollTop).toBeGreaterThan(0);
    expect(h.element.scrollTop).toBeLessThan(1000);
  });

  it('moves further with each frame, and lands exactly', () => {
    const h = harness(0);

    animateScrollTop(h.element, 1000, { duration: 300, ...h.options });

    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      h.step(30);
      seen.push(h.element.scrollTop);
    }

    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(h.element.scrollTop).toBe(1000);
  });

  it('stops scheduling frames once it has arrived', () => {
    // A tween that keeps asking for frames forever is a battery bug.
    const h = harness(0);

    animateScrollTop(h.element, 500, { duration: 100, ...h.options });
    for (let i = 0; i < 10; i += 1) h.step(30);

    expect(h.element.scrollTop).toBe(500);
    expect(h.pending()).toBe(0);
  });

  it('animates upward too', () => {
    const h = harness(1000);

    animateScrollTop(h.element, 0, { duration: 300, ...h.options });
    h.step(50);

    expect(h.element.scrollTop).toBeLessThan(1000);
    expect(h.element.scrollTop).toBeGreaterThan(0);
  });

  it('never scrolls above the top', () => {
    // The destination is the message's position minus a gap, and for the
    // first message in a chat that arithmetic goes negative.
    const h = harness(0);

    animateScrollTop(h.element, -40, { duration: 300, ...h.options });
    for (let i = 0; i < 20; i += 1) h.step(30);

    expect(h.element.scrollTop).toBe(0);
  });

  it('jumps immediately when the customer asked for less motion', () => {
    // prefers-reduced-motion is a request from someone who may get motion
    // sick. It is not a preference to interpret.
    const h = harness(0);

    animateScrollTop(h.element, 1000, {
      duration: 300,
      reducedMotion: true,
      ...h.options,
    });

    expect(h.element.scrollTop).toBe(1000);
    expect(h.pending()).toBe(0);
  });

  it('does nothing at all when it is already there', () => {
    const h = harness(700);

    animateScrollTop(h.element, 700, { duration: 300, ...h.options });

    expect(h.pending()).toBe(0);
    expect(h.element.scrollTop).toBe(700);
  });
});
