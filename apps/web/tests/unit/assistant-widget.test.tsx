// tests/unit/assistant-widget.test.tsx
//
// The panel a customer actually sees. It renders what the provider
// derives and decides nothing of its own -- which is why the interesting
// assertions here are about what it REFUSES to show: a link built from
// agent prose, and an approval button that does not exist yet.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { AssistantWidget } from '@/components/assistant/assistant-widget';

function streamOf(wire: string, status = 200) {
  const encoder = new TextEncoder();
  const chunks = wire ? [wire] : [];
  let index = 0;

  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

function event(seq: number, type: string, data: unknown) {
  return `event: assistant\ndata: ${JSON.stringify({ v: 1, seq, type, data })}\n\n`;
}

function renderWidget() {
  return render(
    <AssistantProvider>
      <AssistantWidget />
    </AssistantProvider>
  );
}

async function open() {
  await act(async () => {
    screen.getByRole('button', { name: /open the shopping assistant/i }).click();
  });
}

async function ask(text = 'what did I order?') {
  // fireEvent.change, not input.value: React tracks a controlled input's
  // value through its own setter, so assigning directly is invisible to it.
  const input = screen.getByLabelText(/message the assistant/i);
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(streamOf(''));
});

describe('AssistantWidget', () => {
  it('is collapsed by default on every page', () => {
    renderWidget();

    expect(
      screen.getByRole('button', { name: /open the shopping assistant/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens into a panel', async () => {
    renderWidget();
    await open();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes without unmounting the conversation', async () => {
    // The whole reason the state lives in the provider: a customer can
    // close the chat, keep shopping, and reopen it mid-thought.
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        streamOf(event(0, 'message', { text: 'You ordered ORD-1.' }))
      );

    renderWidget();
    await open();
    await ask();
    await waitFor(() =>
      expect(screen.getByText(/You ordered ORD-1\./)).toBeInTheDocument()
    );

    await act(async () => {
      screen.getByRole('button', { name: /close the shopping assistant/i }).click();
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    await open();
    expect(screen.getByText(/You ordered ORD-1\./)).toBeInTheDocument();
  });

  it('shows a tool as working before it finishes', async () => {
    // A chip that never resolves is the failure the contract's
    // "every start gets a completion" rule prevents; this shows the
    // in-between state that makes the guarantee visible.
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        streamOf(
          event(0, 'tool_started', {
            call_id: 'c1',
            tool: 'get_orders',
            arguments: {},
          })
        )
      );

    renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText(/Looking up your orders/)).toBeInTheDocument()
    );
    expect(screen.getByText(/working/)).toBeInTheDocument();
  });

  it('shows a failed tool with the storefront’s own words', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        event(0, 'tool_started', {
          call_id: 'c1',
          tool: 'add_to_cart',
          arguments: { quantity: 57 },
        }) +
          event(1, 'tool_completed', {
            call_id: 'c1',
            tool: 'add_to_cart',
            ok: false,
            error: '409: Only 17 available',
          })
      )
    );

    renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText(/Only 17 available/)).toBeInTheDocument()
    );
  });

  it('shows a tool awaiting approval as waiting, with no button', async () => {
    // Task 5 owns the button. A card that looked clickable and did
    // nothing would be worse than one that says it is waiting.
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        event(0, 'approval_required', {
          call_id: 'c1',
          tool: 'cancel_order',
          arguments: { order_id: 'o1' },
        })
      )
    );

    renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText(/waiting for your approval/)).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /approve|confirm|cancel order/i }))
      .toBeNull();
  });

  it('never turns agent prose into a link', async () => {
    // The rendering restriction, asserted where the customer meets it
    // rather than only in the renderer's own tests.
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        event(0, 'message', {
          text: '[Click here to verify](https://evil.example.com/x)',
        })
      )
    );

    const { container } = renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText(/evil\.example\.com/)).toBeInTheDocument()
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('shows the customer their own question', async () => {
    renderWidget();
    await open();
    await ask('where is my order?');

    expect(screen.getByText('where is my order?')).toBeInTheDocument();
  });

  it('reports a failure with a way forward rather than a stalled spinner', async () => {
    global.fetch = jest.fn().mockResolvedValue(streamOf('', 502));

    renderWidget();
    await open();
    await ask();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // The input is usable again, so "try again" is actually possible.
    expect(screen.getByLabelText(/message the assistant/i)).not.toBeDisabled();
  });
});
