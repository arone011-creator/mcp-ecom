// tests/unit/assistant-approval-card.test.tsx
//
// The card a customer actually presses. Its job is to describe an
// irreversible action accurately and then get out of the way.
//
// Everything it shows comes from the server's own lookup of the order.
// Nothing comes from the agent's prose, and nothing comes from the
// event's payload -- the route already refuses to read either, and these
// are the assertions that stop a later "helpful" change from putting
// them back on the screen.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { ApprovalCard } from '@/components/assistant/approval-card';

const FACTS = {
  data: {
    tool: 'cancel_order',
    decided: false,
    order: {
      orderNumber: 'ORD-1042',
      status: 'PENDING',
      total: '59.90',
      currency: 'USD',
      createdAt: '2026-01-01T00:00:00.000Z',
      items: [{ name: 'Runner', quantity: 2 }],
    },
  },
};

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function show() {
  return render(
    <AssistantProvider>
      <ApprovalCard callId="c1" tool="cancel_order" />
    </AssistantProvider>
  );
}

async function shown() {
  const view = show();
  await waitFor(() => expect(screen.getByText(/ORD-1042/)).toBeInTheDocument());
  return view;
}

const press = async (name: RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(json(FACTS));
});

describe('ApprovalCard', () => {
  it('asks the server what the action actually affects', async () => {
    await shown();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/assistant/approval/c1',
      expect.anything()
    );
    expect(screen.getByText(/ORD-1042/)).toBeInTheDocument();
    expect(screen.getByText(/59\.90/)).toBeInTheDocument();
  });

  it('offers no way to approve until it can say what it is approving', async () => {
    // NEVER ASK SOMEONE TO CONFIRM SOMETHING YOU COULD NOT DESCRIBE. A
    // card that rendered its buttons while still loading would let an
    // impatient click cancel an order nobody had seen named.
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    show();

    expect(screen.queryByRole('button', { name: /cancel the order/i })).toBeNull();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('offers no way to approve when the details cannot be loaded', async () => {
    global.fetch = jest.fn().mockResolvedValue(json({ error: 'nope' }, 404));

    show();

    await waitFor(() =>
      expect(screen.getByText(/details could not be loaded/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /cancel the order/i })).toBeNull();
  });

  it('sends only a decision, never the details it was shown', async () => {
    // The route reads `approved` and nothing else, and this is the half
    // that proves the browser never even offers anything else.
    await shown();
    await press(/cancel the order/i);

    const [url, init] = (global.fetch as jest.Mock).mock.calls.at(-1)!;
    expect(url).toBe('/api/assistant/approval/c1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ approved: true });
  });

  it('sends a decline as a decline', async () => {
    await shown();
    await press(/keep the order/i);

    const [, init] = (global.fetch as jest.Mock).mock.calls.at(-1)!;
    expect(JSON.parse(init.body)).toEqual({ approved: false });
  });

  it('does not offer a second click', async () => {
    await shown();
    await press(/cancel the order/i);

    expect(screen.queryByRole('button', { name: /cancel the order/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /keep the order/i })).toBeNull();
  });

  it('does NOT claim the order is cancelled once approved', async () => {
    // THE MUST PROVE. A high-risk action never renders optimistically.
    // Approving only delivers the answer; the agent is still resuming the
    // call, and only a tool_completed event says what actually happened.
    await shown();
    await press(/cancel the order/i);

    await waitFor(() =>
      expect(screen.getByText(/waiting for the shop/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/cancelled/i)).toBeNull();
    expect(screen.queryByText(/\bdone\b/i)).toBeNull();
  });

  it('says so when the decision could not be delivered', async () => {
    await shown();
    (global.fetch as jest.Mock).mockResolvedValueOnce(json({ error: 'no' }, 502));

    await press(/cancel the order/i);

    await waitFor(() =>
      expect(screen.getByText(/could not be sent/i)).toBeInTheDocument()
    );
  });

  it('renders no link, whatever the order is called', async () => {
    // The order's own fields are storefront data, but a shop
    // administrator writes product names, and the same rendering rule
    // that governs agent prose governs anything they wrote.
    global.fetch = jest.fn().mockResolvedValue(
      json({
        data: {
          ...FACTS.data,
          order: {
            ...FACTS.data.order,
            items: [{ name: 'Visit https://evil.example.com/x now', quantity: 1 }],
          },
        },
      })
    );

    const { container } = show();

    await waitFor(() =>
      expect(screen.getByText(/evil\.example\.com/)).toBeInTheDocument()
    );
    expect(container.querySelector('a')).toBeNull();
  });
});
