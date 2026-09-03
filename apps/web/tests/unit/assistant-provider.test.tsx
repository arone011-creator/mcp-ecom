// tests/unit/assistant-provider.test.tsx
//
// The provider holds the raw event array and derives the conversation
// with replay(). Accumulating messages as they arrive would be a second,
// untested implementation of the reducer -- and then the contract both
// repositories agree on would describe something the screen does not
// actually show.

import { act, render, screen, waitFor } from '@testing-library/react';

import {
  AssistantProvider,
  useAssistant,
} from '@/components/assistant/assistant-provider';

// A minimal stand-in rather than a fetch polyfill: the provider uses
// only `ok` and `body.getReader()`, and jsdom has no Response. Chunked
// deliberately, so the parser's buffering is exercised here too and not
// only in its own tests.
function streamOf(wire: string, status = 200) {
  const encoder = new TextEncoder();
  const chunks = wire ? [wire.slice(0, 30), wire.slice(30)] : [];
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

const ONE_TURN =
  'event: assistant\ndata: {"v":1,"seq":0,"type":"tool_started","data":{"call_id":"c1","tool":"get_orders","arguments":{"limit":3}}}\n\n' +
  'event: assistant\ndata: {"v":1,"seq":1,"type":"tool_completed","data":{"call_id":"c1","tool":"get_orders","ok":true,"result":[]}}\n\n' +
  'event: assistant\ndata: {"v":1,"seq":2,"type":"message","data":{"text":"You ordered ORD-1."}}\n\n';

function Probe() {
  const { conversation, status, send } = useAssistant();

  return (
    <div>
      <button onClick={() => send('what did I order?')}>ask</button>
      <span data-testid="status">{status}</span>
      <span data-testid="text">{conversation.text.join('|')}</span>
      <span data-testid="tools">
        {conversation.tools.map((t) => `${t.tool}:${t.ok}`).join('|')}
      </span>
    </div>
  );
}

function renderProbe() {
  return render(
    <AssistantProvider>
      <Probe />
    </AssistantProvider>
  );
}

async function ask() {
  await act(async () => {
    screen.getByText('ask').click();
  });
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(streamOf(ONE_TURN));
});

describe('AssistantProvider', () => {
  it('starts idle with an empty conversation', () => {
    renderProbe();

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('text')).toHaveTextContent('');
  });

  it('derives the conversation from the events it received', async () => {
    renderProbe();
    await ask();

    await waitFor(() => {
      expect(screen.getByTestId('text')).toHaveTextContent('You ordered ORD-1.');
    });
    expect(screen.getByTestId('tools')).toHaveTextContent('get_orders:true');
  });

  it('posts the utterance to the bridge and nowhere else', async () => {
    renderProbe();
    await ask();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe('/api/assistant');
    expect(JSON.parse(init.body)).toEqual({ utterance: 'what did I order?' });
  });

  it('drops a malformed frame and keeps the rest of the stream', async () => {
    // parseEvent returns null rather than throwing, and this is what
    // that decision buys: one bad frame does not cost the conversation.
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        'event: assistant\ndata: {"v":99,"seq":0,"type":"message","data":{"text":"nope"}}\n\n' +
          'event: assistant\ndata: {"v":1,"seq":1,"type":"message","data":{"text":"kept"}}\n\n'
      )
    );
    renderProbe();
    await ask();

    await waitFor(() => {
      expect(screen.getByTestId('text')).toHaveTextContent('kept');
    });
    expect(screen.getByTestId('text')).not.toHaveTextContent('nope');
  });

  it('survives a frame that is not JSON at all', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        streamOf(
          'event: assistant\ndata: not json\n\n' +
            'event: assistant\ndata: {"v":1,"seq":1,"type":"message","data":{"text":"kept"}}\n\n'
        )
      );
    renderProbe();
    await ask();

    await waitFor(() =>
      expect(screen.getByTestId('text')).toHaveTextContent('kept')
    );
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('reports a failed request without losing what came before', async () => {
    renderProbe();
    await ask();
    await waitFor(() =>
      expect(screen.getByTestId('text')).toHaveTextContent('ORD-1')
    );

    global.fetch = jest.fn().mockResolvedValue(streamOf('', 502));
    await ask();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('error')
    );
    // The earlier answer is still on screen. A failure must not wipe the
    // conversation a customer was reading.
    expect(screen.getByTestId('text')).toHaveTextContent('ORD-1');
  });

  it('reports a network failure rather than throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    renderProbe();
    await ask();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('error')
    );
  });

  it('refuses to send while a turn is already in flight', async () => {
    renderProbe();

    await act(async () => {
      screen.getByText('ask').click();
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('ignores a blank utterance without calling the bridge', async () => {
    function BlankProbe() {
      const { send } = useAssistant();
      return <button onClick={() => send('   ')}>blank</button>;
    }

    render(
      <AssistantProvider>
        <BlankProbe />
      </AssistantProvider>
    );
    await act(async () => {
      screen.getByText('blank').click();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
