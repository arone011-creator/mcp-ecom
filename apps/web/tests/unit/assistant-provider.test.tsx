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
function streamOf(wire: string, status = 200, conversationId: string | null = null) {
  const encoder = new TextEncoder();
  const chunks = wire ? [wire.slice(0, 30), wire.slice(30)] : [];
  let index = 0;

  return {
    ok: status >= 200 && status < 300,
    status,
    // The bridge names the conversation in a header. A real Response
    // always has one, so the stand-in must too, or the provider reads
    // `.get` off undefined the moment it starts adopting it.
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-conversation-id' ? conversationId : null,
    },
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

/** Only the turns posted to the bridge -- not the resume-on-mount GET. */
function bridgeCalls(): [string, { body: string }][] {
  return (global.fetch as jest.Mock).mock.calls.filter(
    ([url]) => String(url) === '/api/assistant'
  );
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

    // Selected by url rather than by index: the provider also asks for a
    // conversation to resume on mount, and that call is not this one.
    const bridge = bridgeCalls();
    expect(bridge).toHaveLength(1);
    const [url, init] = bridge[0]!;
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
    expect(bridgeCalls()).toHaveLength(1);
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

    expect(bridgeCalls()).toHaveLength(0);
  });
});

describe('turns own their events', () => {
  function TranscriptProbe() {
    const { transcript, send, status } = useAssistant();

    return (
      <div>
        <button onClick={() => send('first question')}>ask-one</button>
        <button onClick={() => send('second question')}>ask-two</button>
        <span data-testid="status">{status}</span>
        <span data-testid="shape">
          {transcript
            .map(
              (entry) =>
                `${entry.utterance}=>${entry.conversation.timeline
                  .map((item) =>
                    item.kind === 'text' ? item.text : `[${item.kind}]`
                  )
                  .join(',')}`
            )
            .join(' | ')}
        </span>
      </div>
    );
  }

  function renderTranscript() {
    return render(
      <AssistantProvider>
        <TranscriptProbe />
      </AssistantProvider>
    );
  }

  it('files each reply under the question that caused it', async () => {
    // THE BUG. With one flat event array nothing says which answer belongs
    // to which question, so a two-turn conversation cannot be rendered in
    // order however carefully the reducer sorts a single turn.
    const first =
      'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer one"}}\n\n';
    const second =
      'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer two"}}\n\n';

    // Dispatched by url, not queued: the provider also asks for a
    // conversation to resume on mount, and a queue would hand that call
    // the first turn's stream.
    const turns = [streamOf(first), streamOf(second)];
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/conversations/latest')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { conversation: null } }),
        } as unknown as Response;
      }
      return turns.shift()!;
    });

    renderTranscript();

    await act(async () => {
      screen.getByText('ask-one').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );

    await act(async () => {
      screen.getByText('ask-two').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );

    expect(screen.getByTestId('shape')).toHaveTextContent(
      'first question=>answer one | second question=>answer two'
    );
  });
});

describe('resuming a stored conversation', () => {
  function ResumeProbe() {
    const { transcript, conversationId, send } = useAssistant();

    return (
      <div>
        <button onClick={() => send('a follow-up')}>ask</button>
        <span data-testid="conversation">{conversationId ?? 'none'}</span>
        <span data-testid="shape">
          {transcript
            .map(
              (entry) =>
                `${entry.utterance}=>${entry.conversation.timeline
                  .map((item) => (item.kind === 'text' ? item.text : `[${item.kind}]`))
                  .join(',')}`
            )
            .join(' | ')}
        </span>
      </div>
    );
  }

  const STORED = {
    data: {
      conversation: {
        id: 'conv_1',
        title: null,
        turns: [
          {
            utterance: 'what did I order?',
            events: [
              { v: 1, seq: 0, type: 'message', data: { text: 'You ordered ORD-1.' } },
            ],
          },
        ],
      },
    },
  };

  function resumeWith(body: unknown) {
    return jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/conversations/latest')) {
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      }
      return streamOf(
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer two"}}\n\n'
      );
    });
  }

  function renderResume() {
    return render(
      <AssistantProvider>
        <ResumeProbe />
      </AssistantProvider>
    );
  }

  it('shows the conversation the customer was last having', async () => {
    global.fetch = resumeWith(STORED);

    renderResume();

    await waitFor(() =>
      expect(screen.getByTestId('shape')).toHaveTextContent(
        'what did I order?=>You ordered ORD-1.'
      )
    );
    expect(screen.getByTestId('conversation')).toHaveTextContent('conv_1');
  });

  it('continues that conversation rather than starting another', async () => {
    // Without sending the id back, every reload would strand the old chat
    // and begin a new one -- the history list would fill with orphans.
    global.fetch = resumeWith(STORED);

    renderResume();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_1')
    );

    await act(async () => {
      screen.getByText('ask').click();
    });

    const send = bridgeCalls()[0]!;
    expect(JSON.parse(send[1].body)).toEqual({
      utterance: 'a follow-up',
      conversationId: 'conv_1',
    });
  });

  it('starts empty for a customer who has never chatted', async () => {
    global.fetch = resumeWith({ data: { conversation: null } });

    renderResume();

    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('none')
    );
    expect(screen.getByTestId('shape')).toHaveTextContent('');
  });

  it('stays usable when the stored conversation cannot be loaded', async () => {
    // A resume that fails must not take the assistant down with it. A
    // customer who cannot see yesterday's chat can still have a new one.
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/conversations/latest')) {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      return streamOf(
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer"}}\n\n'
      );
    });

    renderResume();

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('shape')).toHaveTextContent('a follow-up=>answer')
    );
  });

  it('drops a stored event it cannot trust', async () => {
    // Stored events go through the SAME door as live ones. They were
    // written by the agent, and a row that has been tampered with or
    // written by an older schema must not take down the panel.
    global.fetch = resumeWith({
      data: {
        conversation: {
          id: 'conv_1',
          title: null,
          turns: [
            {
              utterance: 'hello',
              events: [
                { v: 99, seq: 0, type: 'message', data: { text: 'from the future' } },
                { v: 1, seq: 1, type: 'message', data: { text: 'readable' } },
              ],
            },
          ],
        },
      },
    });

    renderResume();

    await waitFor(() =>
      expect(screen.getByTestId('shape')).toHaveTextContent('hello=>readable')
    );
    expect(screen.getByTestId('shape')).not.toHaveTextContent('from the future');
  });
});
