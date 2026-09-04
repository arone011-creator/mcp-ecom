// tests/unit/order-simulation-panel.test.tsx
//
// The demo controls. Two things matter here: an order that predates this
// feature must show nothing at all, and the panel must stop polling once
// there is nothing left to watch.

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { act, fireEvent, render, screen } from '@testing-library/react';

import { OrderSimulationPanel } from '@/components/orders/order-simulation-panel';

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(
    <OrderSimulationPanel
      orderId="ord_1"
      status="PROCESSING"
      hasClock
      paused={false}
      {...overrides}
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers();
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
    const { container } = renderPanel({ hasClock: false });

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
    renderPanel({ paused: true });

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByText(/Paused\./)).toBeInTheDocument();
  });

  it('resumes through the route when Resume is pressed', async () => {
    renderPanel({ paused: true });

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
    renderPanel({ paused: true });

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
