// tests/unit/order-simulation-panel.test.tsx
//
// The demo controls. Three things matter here: an order that predates
// this feature must show nothing at all, the panel must stop polling once
// there is nothing left to watch, and the countdown must agree with the
// clock the server is actually keeping.

const mockRefresh = jest.fn();
// ONE OBJECT, not a fresh one per call. The real useRouter is stable, and
// a new identity on every render would silently tear down and restart the
// poll interval every second -- so it would never reach fifteen.
const mockRouter = { refresh: mockRefresh };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

import { act, fireEvent, render, screen } from '@testing-library/react';

import { OrderSimulationPanel } from '@/components/orders/order-simulation-panel';

/** The instant every test is pinned to. */
const NOW = new Date('2026-09-05T12:10:00.000Z');

/** A clock that started `seconds` ago. */
function startedSecondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(
    <OrderSimulationPanel
      orderId="ord_1"
      status="PROCESSING"
      // Ninety seconds into a clock whose next step lands at two minutes:
      // thirty seconds to go.
      startedAt={startedSecondsAgo(90)}
      pausedAt={null}
      {...overrides}
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockRefresh.mockReset();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('OrderSimulationPanel', () => {
  it('renders nothing for an order that predates the feature', () => {
    // THE MUST PROVE, on screen. Every order that already existed has a
    // null clock, and must show no controls at all.
    const { container } = renderPanel({ startedAt: null });

    expect(container).toBeEmptyDOMElement();
  });

  it('says the progression is simulated', () => {
    renderPanel();

    expect(screen.getByText(/advances one step each minute/i)).toBeInTheDocument();
  });

  it('warns that the cancellation window closes', () => {
    // Not decoration: after about two minutes the order can no longer be
    // cancelled, which is a real constraint on demonstrating the
    // assistant's approval flow.
    renderPanel();

    expect(screen.getByText(/only be cancelled while it is Placed or Processing/i)).toBeInTheDocument();
  });

  it('offers Pause while it is running', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('pauses through the route when Pause is pressed', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe('/api/orders/ord_1/simulation');
    expect(JSON.parse(init.body)).toEqual({ action: 'pause' });
  });

  it('offers Resume while it is paused, and says so', () => {
    renderPanel({ pausedAt: NOW.toISOString() });

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
  });

  it('resumes through the route when Resume is pressed', async () => {
    renderPanel({ pausedAt: NOW.toISOString() });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ action: 'resume' });
  });

  it('offers no button once the order is delivered', () => {
    renderPanel({ status: 'DELIVERED' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/finished its progression/i)).toBeInTheDocument();
  });

  it('offers no button on a cancelled order', () => {
    renderPanel({ status: 'CANCELLED' });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('re-reads while the order is still moving', () => {
    // The poll IS the advance: the status is written lazily when
    // something reads the order, and this is that read.
    renderPanel();

    act(() => {
      jest.advanceTimersByTime(45_000);
    });

    expect(mockRefresh).toHaveBeenCalled();
  });

  it('does not poll while paused', () => {
    // Nothing is going to change, and a paused order that kept polling
    // would be a page that never settles.
    renderPanel({ pausedAt: NOW.toISOString() });

    act(() => {
      jest.advanceTimersByTime(120_000);
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('does not poll once the order is delivered', () => {
    renderPanel({ status: 'DELIVERED' });

    act(() => {
      jest.advanceTimersByTime(120_000);
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('OrderSimulationPanel countdown', () => {
  it('shows how long until the next step', () => {
    renderPanel();

    expect(screen.getByText('0:30')).toBeInTheDocument();
  });

  it('counts down once a second', () => {
    renderPanel();

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.getByText('0:29')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(9_000);
    });
    expect(screen.getByText('0:20')).toBeInTheDocument();
  });

  it('freezes the countdown while paused', () => {
    // THE MUST PROVE. The order cannot move while paused, so a countdown
    // that kept running would be counting towards a step that is not
    // coming -- and would reach zero and sit there.
    renderPanel({ pausedAt: NOW.toISOString() });

    act(() => {
      jest.advanceTimersByTime(120_000);
    });

    expect(screen.getByText('0:30')).toBeInTheDocument();
  });

  it('shows no countdown once the order is delivered', () => {
    renderPanel({ status: 'DELIVERED' });

    expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
  });

  it('shows no countdown on a cancelled order', () => {
    renderPanel({ status: 'CANCELLED' });

    expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
  });

  it('re-reads the moment the countdown runs out', () => {
    // The whole point of showing a timer: when it says zero, the status
    // should already be changing. Leaving that to the fifteen-second poll
    // would make the countdown look wrong for up to fifteen seconds.
    renderPanel({ startedAt: startedSecondsAgo(115) });

    act(() => {
      jest.advanceTimersByTime(4_000);
    });
    expect(mockRefresh).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not re-read every second once it has run out', () => {
    // If the browser's clock runs ahead of the server's, the countdown
    // reaches zero before the server agrees a step is owed, and the
    // refresh changes nothing. That must settle back into the ordinary
    // poll rather than becoming a refresh once a second.
    renderPanel({ startedAt: startedSecondsAgo(120) });

    act(() => {
      jest.advanceTimersByTime(9_000);
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('says it is updating rather than showing a stuck zero', () => {
    renderPanel({ startedAt: startedSecondsAgo(120) });

    expect(screen.getByText(/updating/i)).toBeInTheDocument();
  });
});
