'use client';

// components/orders/order-simulation-panel.tsx
//
// The demo controls for one order's simulated lifecycle, and the countdown
// to its next step.
//
// LABELLED AS A SIMULATION, on purpose. A real shopper cannot pause their
// own delivery, so dressing these as ordinary tracking controls would
// imply the shop can halt a shipment. The tracker above is untouched; this
// sits below it and says what it is.
//
// THE POLLING HERE IS ALSO WHAT MAKES THE ORDER ADVANCE. The status is
// written lazily when something reads the order, and router.refresh() is
// that read.
//
// TIMESTAMPS IN, NOT FLAGS. It takes the two clock columns rather than a
// hasClock/paused pair derived from them, because the countdown needs the
// timestamps anyway and two derived flags alongside them could disagree
// with them -- a countdown running on an order the page thought had no
// clock is exactly the sort of contradiction props like that allow.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';

import type { OrderStatus } from '@prisma/client';
import { formatCountdown, msUntilNextStep } from '@/lib/orders/simulation';

/** How often to re-read while an order is still moving. */
const POLL_MS = 15_000;

/** How often the countdown redraws. */
const TICK_MS = 1_000;

/** The statuses that still have somewhere to go. */
const MOVING = new Set<string>(['PENDING', 'PROCESSING', 'SHIPPED']);

interface Props {
  orderId: string;
  status: OrderStatus;
  /** Null for every order that predates this feature. */
  startedAt: string | null;
  pausedAt: string | null;
}

export function OrderSimulationPanel({
  orderId,
  status,
  startedAt,
  pausedAt,
}: Props) {
  const router = useRouter();

  // HELD IN A REF so the timers below depend only on the things that
  // should restart them. useRouter is stable in practice, but a router in
  // an interval's dependencies means that if it ever stopped being stable,
  // the interval would be torn down and restarted on every one of these
  // once-a-second renders -- and the fifteen-second poll would never once
  // reach fifteen seconds. That failure would be completely silent.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [busy, setBusy] = useState(false);

  const started = startedAt ? new Date(startedAt) : null;
  const pause = pausedAt ? new Date(pausedAt) : null;
  const paused = pause !== null;
  const moving = MOVING.has(status);

  // Null until mounted, and deliberately so: the server renders no time at
  // all, so the first client render agrees with it. Reading the browser's
  // clock during render would be a hydration mismatch by construction.
  const [now, setNow] = useState<number | null>(null);

  const ticking = started !== null && !paused && moving;

  useEffect(() => {
    if (!ticking) return;

    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [ticking]);

  useEffect(() => {
    // Nothing to watch: no clock, paused, or already at the end. A
    // delivered order polling forever would be a page that never settles.
    if (!ticking) return;

    const poll = setInterval(() => routerRef.current.refresh(), POLL_MS);
    return () => clearInterval(poll);
  }, [ticking]);

  // While paused the answer does not depend on the browser's clock at all
  // -- msUntilNextStep measures to the pause instead -- so it is safe to
  // compute before mount, and the zero passed for `now` goes unread.
  const remaining =
    paused || now !== null
      ? msUntilNextStep(status, started, pause, new Date(now ?? 0))
      : null;

  // Fires ONCE as the countdown crosses zero. The step is due at that
  // instant and the read that writes it is this refresh, so the timer
  // reaching 0:00 and the status changing happen together instead of up to
  // fifteen seconds apart.
  //
  // It cannot degrade into a refresh per second: if the browser's clock
  // runs ahead of the server's, the refresh changes nothing, remaining
  // stays pinned at zero, and an unchanged dependency does not re-run the
  // effect. The poll above is the safety net for exactly that case.
  useEffect(() => {
    if (remaining !== 0) return;

    routerRef.current.refresh();
  }, [remaining]);

  // Every order that predates this feature. Nothing to say about it, and
  // nothing that could be paused.
  if (started === null) return null;

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/orders/${encodeURIComponent(orderId)}/simulation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: paused ? 'resume' : 'pause' }),
      });
      router.refresh();
    } catch {
      // The panel stays as it was. A failed demo control is not worth an
      // error message on a page about somebody's order.
    } finally {
      setBusy(false);
    }
  }

  const timer =
    remaining === null || remaining === 0 ? null : (
      <span className="font-mono font-semibold tabular-nums">
        {formatCountdown(remaining)}
      </span>
    );

  function line() {
    if (!moving) return <>This order has finished its progression.</>;

    // Before the first tick, and for a status that is not on the ladder.
    if (remaining === null) return <>{paused ? 'Paused.' : 'Running.'}</>;

    if (paused) {
      // A step owed at the instant of the pause is still owed and will be
      // taken on the next read -- but nothing polls while paused, so
      // saying "Updating" here would leave that word on screen for good.
      return timer ? (
        <>Paused, with {timer} still to go.</>
      ) : (
        <>Paused. Its next step is already due.</>
      );
    }

    return timer ? <>Next step in {timer}.</> : <>Updating&hellip;</>;
  }

  return (
    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-amber-900">
            Demo &mdash; this order advances one step each minute
          </p>
          <p className="mt-1 text-amber-800">{line()}</p>
        </div>

        {moving ? (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {paused ? (
              <Play aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Pause aria-hidden="true" className="h-4 w-4" />
            )}
            {paused ? 'Resume' : 'Pause'}
          </button>
        ) : null}
      </div>

      {/* NOT DECORATION. cancelOrderFor permits only PENDING and
          PROCESSING, so after about two minutes this order can no longer
          be cancelled -- which is both the only reliable way to
          demonstrate the assistant's failure path and a two-minute window
          on demonstrating its approval flow. Better said than discovered. */}
      <p className="mt-3 border-t border-amber-200 pt-2 text-xs text-amber-700">
        An order can only be cancelled while it is Placed or Processing.
        Pause it if you want to try cancelling it from the assistant.
      </p>
    </div>
  );
}
