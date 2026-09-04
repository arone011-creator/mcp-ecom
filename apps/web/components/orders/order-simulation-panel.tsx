'use client';

// components/orders/order-simulation-panel.tsx
//
// The demo controls for one order's simulated lifecycle.
//
// LABELLED AS A SIMULATION, on purpose. A real shopper cannot pause their
// own delivery, so dressing these as ordinary tracking controls would
// imply the shop can halt a shipment. The tracker above is untouched; this
// sits below it and says what it is.
//
// THE POLLING HERE IS ALSO WHAT MAKES THE ORDER ADVANCE. The status is
// written lazily when something reads the order, and router.refresh() is
// that read.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';

/** How often to re-read while an order is still moving. */
const POLL_MS = 15_000;

/** The statuses that still have somewhere to go. */
const MOVING = new Set(['PENDING', 'PROCESSING', 'SHIPPED']);

interface Props {
  orderId: string;
  status: string;
  /** False for every order that predates this feature. */
  hasClock: boolean;
  paused: boolean;
}

export function OrderSimulationPanel({
  orderId,
  status,
  hasClock,
  paused,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const moving = MOVING.has(status);

  useEffect(() => {
    // Nothing to watch: no clock, paused, or already at the end. A
    // delivered order polling forever would be a page that never settles.
    if (!hasClock || paused || !moving) return;

    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasClock, paused, moving, router]);

  // Every order that predates this feature. Nothing to say about it, and
  // nothing that could be paused.
  if (!hasClock) return null;

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

  return (
    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-amber-900">
            Demo &mdash; this order advances one step each minute
          </p>
          <p className="mt-1 text-amber-800">
            {!moving
              ? 'This order has finished its progression.'
              : paused
                ? 'Paused. It will not move until you resume it.'
                : 'Running.'}
          </p>
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
