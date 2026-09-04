// tests/unit/assistant-widget.test.tsx
//
// The panel a customer actually sees. It renders what the provider
// derives and decides nothing of its own -- which is why the interesting
// assertions here are about what it REFUSES to show: a link built from
// agent prose, and any fact about an irreversible action that came from
// the agent rather than from the shop.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/assistant/smooth-scroll', () => ({
  ...jest.requireActual('@/lib/assistant/smooth-scroll'),
  animateScrollTop: jest.fn(),
}));

import { animateScrollTop } from '@/lib/assistant/smooth-scroll';
import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { AssistantWidget } from '@/components/assistant/assistant-widget';

function streamOf(wire: string, status = 200) {
  const encoder = new TextEncoder();
  const chunks = wire ? [wire] : [];
  let index = 0;

  return {
    ok: status >= 200 && status < 300,
    status,
    // The bridge names the conversation in a header; a real Response
    // always has one.
    headers: { get: () => null },
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

// A stream the TEST decides when to feed. streamOf above hands over
// everything at once, which cannot tell "shown while arriving" from
// "shown once finished" -- the exact distinction this feature is about.
function controlledStream() {
  const encoder = new TextEncoder();
  const waiting: string[] = [];
  let pending: ((value: unknown) => void) | null = null;
  let ended = false;

  const deliver = (value: unknown) => {
    const resolve = pending!;
    pending = null;
    resolve(value);
  };

  return {
    response: {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: () => {
            if (waiting.length) {
              return Promise.resolve({
                done: false,
                value: encoder.encode(waiting.shift()!),
              });
            }
            if (ended) return Promise.resolve({ done: true, value: undefined });
            return new Promise((resolve) => {
              pending = resolve;
            });
          },
        }),
      },
    } as unknown as Response,

    push(wire: string) {
      if (pending) deliver({ done: false, value: encoder.encode(wire) });
      else waiting.push(wire);
    },

    end() {
      ended = true;
      if (pending) deliver({ done: true, value: undefined });
    },
  };
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
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  });
}

const mockAnimate = animateScrollTop as unknown as jest.Mock;

beforeEach(() => {
  mockAnimate.mockClear();
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

  it('turns a call awaiting approval into a card built from the shop’s facts', async () => {
    // The chip became a decision in Task 5. What matters here is WHERE
    // the words come from: the order number on the card is the one the
    // server looked up, not the one the event carried and not anything
    // the model wrote.
    const wire =
      event(0, 'approval_required', {
        call_id: 'c1',
        tool: 'cancel_order',
        arguments: { order_id: 'o1', orderNumber: 'ORD-FROM-THE-EVENT' },
      }) +
      event(1, 'message', {
        text: 'I have already cancelled it for you. [Confirm](https://evil.example.com/x)',
      });

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/assistant/approval/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              tool: 'cancel_order',
              decided: false,
              order: {
                orderNumber: 'ORD-1042',
                status: 'PENDING',
                total: '59.90',
                currency: 'USD',
                items: [{ name: 'Runner', quantity: 2 }],
              },
            },
          }),
        } as unknown as Response;
      }
      return streamOf(wire);
    });

    const { container } = renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText(/ORD-1042/)).toBeInTheDocument()
    );

    // The event's claim about the order never reaches the screen.
    expect(container.textContent).not.toContain('ORD-FROM-THE-EVENT');

    // And the agent claiming it is already done changes nothing about
    // the control: the confirmation is still there, still unanswered.
    expect(
      screen.getByRole('button', { name: /cancel the order/i })
    ).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
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

  it('shows the answer while it is still arriving', async () => {
    // The complaint this feature answers: the whole reply appeared at
    // once, after a long silence. Asserted against a stream the test
    // feeds one fragment at a time, because a stream delivered in one
    // go looks identical to a finished answer.
    const stream = controlledStream();
    global.fetch = jest.fn().mockResolvedValue(stream.response);

    renderWidget();
    await open();
    await ask();

    await act(async () => {
      stream.push(event(-1, 'message_delta', { text: 'Your most ' }));
    });
    await waitFor(() =>
      expect(screen.getByText(/Your most/)).toBeInTheDocument()
    );

    await act(async () => {
      stream.push(event(-1, 'message_delta', { text: 'recent order is ORD-1.' }));
    });
    await waitFor(() =>
      expect(
        screen.getByText('Your most recent order is ORD-1.')
      ).toBeInTheDocument()
    );
  });

  it('does not show the answer twice when the finished message lands', async () => {
    // The rule the whole delta design turns on: the authoritative message
    // REPLACES the fragments rather than joining them. Get this wrong and
    // the customer reads the reply, then reads it again underneath.
    const answer = 'Your most recent order is ORD-1.';
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        streamOf(
          event(-1, 'message_delta', { text: 'Your most recent ' }) +
            event(-1, 'message_delta', { text: 'order is ORD-1.' }) +
            event(0, 'message', { text: answer })
        )
      );

    renderWidget();
    await open();
    await ask();

    await waitFor(() => expect(screen.getByText(answer)).toBeInTheDocument());
    expect(screen.getAllByText(answer)).toHaveLength(1);
  });

  it('keeps the redacted wording when the fragments carried a link', async () => {
    // The fragments are redacted a word at a time and the message over
    // the whole answer. Where they differ the message wins -- so what
    // stays on screen is the redacted text, not the fragment that
    // happened to arrive first.
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        event(-1, 'message_delta', { text: 'Visit https://evil.example.com/x' }) +
          event(0, 'message', { text: 'Visit [link removed]' })
      )
    );

    const { container } = renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText(/link removed/)).toBeInTheDocument()
    );
    expect(container.textContent).not.toContain('evil.example.com');
  });


  it('reads as a conversation: question, answer, question, answer', async () => {
    // THE BUG THIS TEST EXISTS FOR. The panel rendered every utterance,
    // then every tool chip, then every assistant message -- grouped by
    // kind rather than by when. One exchange looked perfect, which is why
    // no screenshot caught it; two exchanges came out as Q1 Q2 A1 A2.
    //
    // Asserted on DOM ORDER, because that is the whole feature. Asserting
    // that all four strings are present would pass on the broken version.
    const answer = (text: string) =>
      `event: assistant
data: ${JSON.stringify({
        v: 1,
        seq: 0,
        type: 'message',
        data: { text },
      })}

`;

    // Dispatched by url, not queued: the provider also asks for a
    // conversation to resume on mount, and a queue would hand that call
    // the first turn's stream.
    const turns = [
      streamOf(answer('Your last order was ORD-1.')),
      streamOf(answer('It ships on Friday.')),
    ];
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/assistant/conversations')) {
        // Covers BOTH the resume and the list. Without the list branch
        // that request would take a turn's stream off the queue.
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { conversation: null, conversations: [] } }),
        } as unknown as Response;
      }
      return turns.shift()!;
    });

    const { container } = renderWidget();
    await open();

    await ask('what did I order?');
    await waitFor(() => expect(screen.getByText(/ORD-1\./)).toBeInTheDocument());

    await ask('when does it ship?');
    await waitFor(() =>
      expect(screen.getByText(/ships on Friday/)).toBeInTheDocument()
    );

    const shown = [...container.querySelectorAll('p')]
      .map((node) => node.textContent ?? '')
      .filter((line) =>
        /what did I order|ORD-1\.|when does it ship|ships on Friday/.test(line)
      );

    expect(shown).toEqual([
      'what did I order?',
      'Your last order was ORD-1.',
      'when does it ship?',
      'It ships on Friday.',
    ]);
  });

  it('puts the customer on the right and the assistant on the left', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        streamOf(event(0, 'message', { text: 'You ordered ORD-1.' }))
      );

    renderWidget();
    await open();
    await ask('what did I order?');
    await waitFor(() =>
      expect(screen.getByText(/You ordered ORD-1\./)).toBeInTheDocument()
    );

    // self-end is what pushes a bubble to the right in a flex column.
    expect(screen.getByText('what did I order?').className).toContain('self-end');
    expect(
      screen.getByText(/You ordered ORD-1\./).closest('div')!.className
    ).toContain('self-start');
  });

  it('shows the customer their own question', async () => {
    renderWidget();
    await open();
    await ask('where is my order?');

    expect(screen.getByText('where is my order?')).toBeInTheDocument();
  });

  it('shows a turn that failed midway rather than falling silent', async () => {
    // WHAT A BROKEN DEPLOY LOOKED LIKE. The agent raised after the
    // response had already begun, so the stream ended cleanly with
    // nothing in it, and the panel showed the question and then blank --
    // indistinguishable from an assistant with nothing to say. The
    // contract's `error` event exists for this; the panel now renders it.
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        event(-1, 'error', {
          message: 'The assistant ran into a problem and could not finish that.',
          retryable: true,
        })
      )
    );

    renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText(/could not finish that/)).toBeInTheDocument()
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not leave a completed turn looking like it is still working', async () => {
    // The other half of the blank panel: a stream that ends with no
    // message and no error at all. Saying nothing is a state the
    // customer cannot act on.
    global.fetch = jest.fn().mockResolvedValue(streamOf(''));

    renderWidget();
    await open();
    await ask();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/Working/)).toBeNull();
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

describe('icons instead of words, and where the view sits', () => {
  it('labels the icon buttons for a screen reader', async () => {
    // The words went away; the accessible names must not. A button whose
    // only content is an svg is unusable without one.
    renderWidget();
    await open();

    expect(
      screen.getByRole('button', { name: 'Send message' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close the shopping assistant' })
    ).toBeInTheDocument();

    // And they really are icons now, not words.
    expect(screen.queryByText('Send')).toBeNull();
    expect(screen.queryByText('Close')).toBeNull();
  });

  it('brings the newest question to the top of the panel', async () => {
    // THE BUG. Without this the answer streams in below the fold and the
    // customer watches an unchanged screen while it arrives.
    renderWidget();
    await open();
    await ask('what did I order?');

    // jsdom has no layout, so every rectangle here is zero and the
    // computed destination is the gap, negative. That the panel asks to
    // be moved -- and by how much relative to the message -- is what can
    // be seen from here; animateScrollTop's own tests cover the motion.
    await waitFor(() => expect(mockAnimate).toHaveBeenCalled());

    const [element, destination] = mockAnimate.mock.calls[0]!;
    expect(element).toBe(
      screen.getByLabelText(/message the assistant/i).closest('[role=dialog]')
        ?.querySelector('.overflow-y-auto')
    );
    // The gap under the header: the message is placed BELOW the rule, not
    // flush against it.
    expect(destination).toBe(-12);
  });

  it('does not yank the view on every fragment as the answer streams', async () => {
    // Scrolling per delta would fight a customer who scrolled up to read
    // something. The view is placed once, when the question is asked.
    const stream = controlledStream();
    global.fetch = jest.fn().mockResolvedValue(stream.response);

    renderWidget();
    await open();
    await ask('what did I order?');

    const afterAsking = mockAnimate.mock.calls.length;

    await act(async () => {
      stream.push(event(0, 'message_delta', { text: 'You ' }));
      stream.push(event(1, 'message_delta', { text: 'ordered ' }));
      stream.push(event(2, 'message_delta', { text: 'ORD-1.' }));
    });

    expect(mockAnimate.mock.calls).toHaveLength(afterAsking);

    await act(async () => {
      stream.end();
    });
  });

  it('leaves room under the last turn so it can actually reach the top', async () => {
    // A turn cannot scroll to the top of its container unless there is a
    // container's worth of space beneath it. The last block reserves it;
    // the ones above must not, or the transcript becomes a slideshow.
    const { container } = renderWidget();
    await open();
    await ask('first question');
    await ask('second question');

    const blocks = container.querySelectorAll('[data-turn]');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.className).not.toMatch(/min-h-/);
    // min-h-FULL specifically. A percentage height resolves against the
    // content box, which has already had the container's padding removed,
    // so a calc that subtracts it again reserves too little and the block
    // stops short of the top -- measured, not guessed.
    expect(blocks[1]!.className).toMatch(/min-h-full/);
  });
});

describe('the panel header', () => {
  it('offers a new chat and a history button', async () => {
    renderWidget();
    await open();

    expect(
      screen.getByRole('button', { name: 'Start a new chat' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show chat history' })
    ).toBeInTheDocument();
  });

  it('shows the history when the history button is clicked', async () => {
    renderWidget();
    await open();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show chat history' }));
    });

    // The empty-state wording of ConversationList, which is what renders
    // when the provider has no chats.
    expect(screen.getByText(/No chats yet/i)).toBeInTheDocument();
  });

  it('goes back to the conversation from the history', async () => {
    renderWidget();
    await open();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show chat history' }));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Back to the conversation' })
      );
    });

    expect(screen.getByPlaceholderText('Ask something')).toBeInTheDocument();
  });

  it('hides the message box while the history is showing', async () => {
    // Typing into a box that would post to whichever chat happens to be
    // open is a way to send a message to the wrong conversation.
    renderWidget();
    await open();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show chat history' }));
    });

    expect(screen.queryByPlaceholderText('Ask something')).toBeNull();
  });

  it('disables both header buttons while a turn is streaming', async () => {
    // THE MUST PROVE, on the rendering side. The provider refuses anyway,
    // but a button that looks live and does nothing is its own bug.
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/assistant/conversations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { conversations: [], conversation: null },
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
      } as unknown as Response;
    });

    renderWidget();
    await open();
    await ask('what did I order?');

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start a new chat' })
      ).toBeDisabled()
    );
    expect(
      screen.getByRole('button', { name: 'Show chat history' })
    ).toBeDisabled();
  });
});

describe('rich results and progress', () => {
  const ORDER = {
    id: 'o1',
    orderNumber: 'ORD-42',
    status: 'CANCELLED',
    total: '1089.98',
    createdAt: '2026-09-03T17:59:48.711Z',
    orderItems: [{ productName: 'iPhone 15 Pro', quantity: 1, price: '999.99' }],
  };

  function turn(...frames: string[]) {
    return frames.join('');
  }

  it('shows an order card beneath the chip that produced it', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        turn(
          event(0, 'tool_started', { call_id: 'c1', tool: 'get_orders', arguments: {} }),
          event(1, 'tool_completed', {
            call_id: 'c1',
            tool: 'get_orders',
            ok: true,
            result: [ORDER],
          }),
          event(2, 'message', { text: 'Here they are.' })
        )
      )
    );
    renderWidget();
    await open();
    await ask();

    await waitFor(() => expect(screen.getByText(/ORD-42/)).toBeInTheDocument());
    // And the assistant's own sentence is still there: the card shows the
    // data, the sentence answers the question.
    expect(screen.getByText('Here they are.')).toBeInTheDocument();
  });

  it('shows no card for a tool with no card model', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        turn(
          event(0, 'tool_started', {
            call_id: 'c1',
            tool: 'check_inventory',
            arguments: {},
          }),
          event(1, 'tool_completed', {
            call_id: 'c1',
            tool: 'check_inventory',
            ok: true,
            result: { inStock: true },
          }),
          event(2, 'message', { text: 'It is in stock.' })
        )
      )
    );
    renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByText('It is in stock.')).toBeInTheDocument()
    );
    expect(screen.getByText('Checking stock')).toBeInTheDocument();
    expect(screen.queryByLabelText('Orders')).toBeNull();
    expect(screen.queryByLabelText('Products found')).toBeNull();
  });

  it('shows the steps of a two-tool turn', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        turn(
          event(0, 'tool_started', { call_id: 'c1', tool: 'get_orders', arguments: {} }),
          event(1, 'tool_completed', {
            call_id: 'c1',
            tool: 'get_orders',
            ok: true,
            result: [],
          }),
          event(2, 'tool_started', { call_id: 'c2', tool: 'get_cart', arguments: {} }),
          event(3, 'tool_completed', {
            call_id: 'c2',
            tool: 'get_cart',
            ok: true,
            result: { itemCount: 0, subtotal: '0.00', items: [] },
          }),
          event(4, 'message', { text: 'Done.' })
        )
      )
    );
    renderWidget();
    await open();
    await ask();

    await waitFor(() => expect(screen.getByText(/2 of 2 done/)).toBeInTheDocument());
  });

  it('shows no steps for a one-tool turn', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        turn(
          event(0, 'tool_started', { call_id: 'c1', tool: 'get_orders', arguments: {} }),
          event(1, 'tool_completed', {
            call_id: 'c1',
            tool: 'get_orders',
            ok: true,
            result: [],
          }),
          event(2, 'message', { text: 'Done.' })
        )
      )
    );
    renderWidget();
    await open();
    await ask();

    await waitFor(() => expect(screen.getByText('Done.')).toBeInTheDocument());
    expect(screen.queryByText(/of 1 done/)).toBeNull();
  });

  it('offers a way forward when a tool fails, and hides it once dismissed', async () => {
    // THE MUST PROVE, through the whole panel rather than the chip alone.
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        turn(
          event(0, 'tool_started', {
            call_id: 'c1',
            tool: 'cancel_order',
            arguments: {},
          }),
          event(1, 'tool_completed', {
            call_id: 'c1',
            tool: 'cancel_order',
            ok: false,
            error: 'That order has already been cancelled.',
          }),
          event(2, 'message', { text: 'I could not do that.' })
        )
      )
    );
    renderWidget();
    await open();
    await ask();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    });

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // Dismissing hides a notice; it does not edit the record. The
    // assistant's own sentence about the failure stays.
    expect(screen.getByText('I could not do that.')).toBeInTheDocument();
  });
});
