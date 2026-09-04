// lib/assistant/smooth-scroll.ts
//
// The assistant panel animates its own scrolling.
//
// WHY NOT THE BROWSER'S. Measured against the deployed build in Chrome,
// on the panel's own scroll container: scrollIntoView with
// behavior:'smooth' moved it by nothing, scrollTo with behavior:'smooth'
// moved it by nothing, and CSS scroll-behavior:smooth moved it by
// nothing -- while a plain scrollTop assignment moved it correctly every
// time. Rather than ship an effect that depends on a feature observed not
// to work here, the tween is ours.
//
// Being ours, it is also testable frame by frame, which the browser's is
// not: jsdom has no layout and no scroll animation, so "we asked for
// smooth" was the most a test could ever have asserted.

/** How long the panel takes to move. Long enough to read as motion. */
const DEFAULT_DURATION = 320;

export interface AnimateOptions {
  duration?: number;
  /** Skip the animation entirely. Defaults to the customer's own setting. */
  reducedMotion?: boolean;
  /** Milliseconds, monotonic. Injected so tests own the clock. */
  clock?: () => number;
  /** Schedules the next frame. Injected so tests own the frames. */
  schedule?: (callback: () => void) => void;
}

/**
 * Fast at first, easing to a stop.
 *
 * The deceleration is the part that reads as movement; a linear ramp over
 * the same duration still looks like a jump that happens to take a moment.
 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/**
 * Does this viewer want less motion?
 *
 * Guarded: jsdom has no matchMedia, and a helper that throws in tests is
 * a helper nobody can use. Answering "no" when we cannot tell is the safe
 * default -- it is the behaviour everybody had before this existed.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Scroll `element` to `to`, over time.
 *
 * `to` is clamped at zero: the caller computes it as a message's position
 * minus a gap, and for the first message in a chat that arithmetic is
 * negative.
 */
export function animateScrollTop(
  element: { scrollTop: number },
  to: number,
  options: AnimateOptions = {}
): void {
  const {
    duration = DEFAULT_DURATION,
    reducedMotion = prefersReducedMotion(),
    clock = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
    schedule = (callback: () => void) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => callback());
      } else {
        setTimeout(callback, 16);
      }
    },
  } = options;

  const destination = Math.max(0, to);
  const from = element.scrollTop;
  const distance = destination - from;

  if (distance === 0) return;

  // A request from someone who may get motion sick. Not a preference to
  // interpret, and not a reason to skip the scroll itself.
  if (reducedMotion || duration <= 0) {
    element.scrollTop = destination;
    return;
  }

  const startedAt = clock();

  const frame = () => {
    const elapsed = clock() - startedAt;

    if (elapsed >= duration) {
      // Assigned exactly rather than left wherever the easing landed, so
      // the message sits where it was aimed and not a pixel off.
      element.scrollTop = destination;
      return;
    }

    element.scrollTop = from + distance * easeOutCubic(elapsed / duration);
    schedule(frame);
  };

  schedule(frame);
}
