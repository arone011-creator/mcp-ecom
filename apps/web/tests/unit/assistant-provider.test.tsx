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

describe('managing several chats', () => {
  const LIST = {
    data: {
      conversations: [
        {
          id: 'conv_2',
          name: 'Cancelling an order',
          lastTurnAt: '2026-09-04T11:00:00.000Z',
        },
        {
          id: 'conv_1',
          name: 'what did I order?',
          lastTurnAt: '2026-09-03T09:00:00.000Z',
        },
      ],
    },
  };

  const OPENED = {
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

  const RESUMED = {
    data: {
      conversation: {
        id: 'conv_2',
        title: null,
        turns: [
          {
            utterance: 'cancel ORD-9 please',
            events: [
              { v: 1, seq: 0, type: 'message', data: { text: 'Cancelled.' } },
            ],
          },
        ],
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

  /** Routes each url to its own answer, so nothing depends on call order. */
  function api(overrides: Record<string, Response> = {}) {
    return jest
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const key = `${init?.method ?? 'GET'} ${path}`;
        if (overrides[key]) return overrides[key]!;
        if (path.includes('/conversations/latest')) return json(RESUMED);
        if (path.endsWith('/api/assistant/conversations')) return json(LIST);
        if (path.includes('/api/assistant/conversations/')) {
          if (init?.method === 'DELETE') return json({ data: { deleted: true } });
          return json(OPENED);
        }
        return streamOf(
          'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"a reply"}}\n\n'
        );
      });
  }

  function ChatsProbe() {
    const {
      conversationId,
      conversations,
      transcript,
      status,
      send,
      newChat,
      openConversation,
      deleteConversation: remove,
    } = useAssistant();

    return (
      <div>
        <button onClick={() => send('a question')}>ask</button>
        <button onClick={() => newChat()}>new</button>
        <button onClick={() => openConversation('conv_1')}>open-1</button>
        <button onClick={() => remove('conv_1')}>delete-1</button>
        <button onClick={() => remove('conv_2')}>delete-2</button>
        <span data-testid="status">{status}</span>
        <span data-testid="conversation">{conversationId ?? 'none'}</span>
        <span data-testid="names">
          {conversations.map((c) => c.name).join(' | ')}
        </span>
        <span data-testid="utterances">
          {transcript.map((entry) => entry.utterance).join(' | ')}
        </span>
      </div>
    );
  }

  function renderChats() {
    return render(
      <AssistantProvider>
        <ChatsProbe />
      </AssistantProvider>
    );
  }

  it('loads the list of chats on mount', async () => {
    global.fetch = api();

    renderChats();

    await waitFor(() =>
      expect(screen.getByTestId('names')).toHaveTextContent(
        'Cancelling an order | what did I order?'
      )
    );
  });

  it('starts a new chat WITHOUT storing anything', async () => {
    // THE MUST PROVE. A row created when you press + would leave a phantom
    // empty chat in the list every time somebody changed their mind.
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    const before = (global.fetch as jest.Mock).mock.calls.length;

    await act(async () => {
      screen.getByText('new').click();
    });

    expect(screen.getByTestId('conversation')).toHaveTextContent('none');
    expect(screen.getByTestId('utterances')).toHaveTextContent('');
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(before);
  });

  it('opens a chat from the list and shows its turns', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('open-1').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_1')
    );
    expect(screen.getByTestId('utterances')).toHaveTextContent(
      'what did I order?'
    );
  });

  it('refuses to switch chats while a turn is streaming', async () => {
    // THE MUST PROVE. The stream in flight belongs to the chat that is
    // open; switching under it would file the answer against the wrong
    // conversation. The header buttons are disabled too, but that is a
    // rendering detail and this is the invariant.
    const slow = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
    } as unknown as Response;

    global.fetch = api({ 'POST /api/assistant': slow });

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('ask').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('streaming')
    );

    await act(async () => {
      screen.getByText('open-1').click();
      screen.getByText('new').click();
    });

    // Still the chat the stream belongs to.
    expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2');
  });

  it('deletes a chat and drops it from the list', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('names')).toHaveTextContent('what did I order?')
    );

    await act(async () => {
      screen.getByText('delete-1').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('names')).not.toHaveTextContent(
        'what did I order?'
      )
    );
    expect(screen.getByTestId('names')).toHaveTextContent('Cancelling an order');
  });

  it('clears the panel when the chat being deleted is the open one', async () => {
    // Otherwise the transcript stays on screen after its rows are gone,
    // and the next message is posted against a deleted conversation --
    // a 404 on a chat the customer is looking at.
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('delete-2').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('none')
    );
    expect(screen.getByTestId('utterances')).toHaveTextContent('');
  });

  it('leaves the open chat alone when a DIFFERENT one is deleted', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('delete-1').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('names')).not.toHaveTextContent(
        'what did I order?'
      )
    );
    expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2');
    expect(screen.getByTestId('utterances')).toHaveTextContent(
      'cancel ORD-9 please'
    );
  });

  it('refreshes the list after a message, so a new chat appears in it', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    const listCallsBefore = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) => String(url).endsWith('/api/assistant/conversations')
    ).length;

    await act(async () => {
      screen.getByText('ask').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );

    const listCallsAfter = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) => String(url).endsWith('/api/assistant/conversations')
    ).length;

    expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
  });

  it('stays usable when the list cannot be loaded', async () => {
    global.fetch = api({ 'GET /api/assistant/conversations': json({}, 500) });

    renderChats();

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('utterances')).toHaveTextContent('a question')
    );
  });
});

describe('naming a conversation', () => {
  /** A fetch that streams turns from the bridge and answers everything else. */
  function dispatching(wire = ONE_TURN, conversationId: string | null = 'conv_1') {
    return jest.fn().mockImplementation(async (url: string) => {
      if (String(url) === '/api/assistant') return streamOf(wire, 200, conversationId);
      // The list refresh, the resume-on-mount, and the title POST.
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: { conversations: [], conversation: null } }),
      } as unknown as Response;
    });
  }

  function titleCalls(): string[] {
    return (global.fetch as jest.Mock).mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.endsWith('/title'));
  }

  it('asks for a name after the first turn', async () => {
    // Once, after turn one. The row exists by now -- the bridge created
    // it -- and the panel knows its id from the response header.
    global.fetch = dispatching();
    renderProbe();
    await ask();

    await waitFor(() => expect(titleCalls()).toHaveLength(1));
    expect(titleCalls()[0]).toBe('/api/assistant/conversations/conv_1/title');
  });

  it('posts it, rather than reading it', async () => {
    global.fetch = dispatching();
    renderProbe();
    await ask();

    await waitFor(() => expect(titleCalls()).toHaveLength(1));
    const call = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).endsWith('/title')
    );
    expect(call![1].method).toBe('POST');
    // No body. The route reads the exchange out of the database, so the
    // browser cannot choose the text the model is shown.
    expect(call![1].body).toBeUndefined();
  });

  it('does not ask again on later turns', async () => {
    // The route is idempotent anyway, so this is about not spending a
    // request per message for the life of a conversation.
    global.fetch = dispatching();
    renderProbe();
    await ask();
    await waitFor(() => expect(titleCalls()).toHaveLength(1));
    await ask();

    await waitFor(() =>
      expect(bridgeCalls()).toHaveLength(2)
    );
    expect(titleCalls()).toHaveLength(1);
  });

  it('does not ask when the turn produced nothing', async () => {
    // A turn that died has no answer to name, and the row may not even
    // have been written.
    global.fetch = dispatching('');
    renderProbe();
    await ask();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('error')
    );
    expect(titleCalls()).toHaveLength(0);
  });

  it('leaves the chat working when naming fails', async () => {
    // THE MUST PROVE, on this side: the panel must not care.
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/title')) throw new Error('agent is down');
      if (String(url) === '/api/assistant') return streamOf(ONE_TURN, 200, 'conv_1');
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: { conversations: [], conversation: null } }),
      } as unknown as Response;
    });
    renderProbe();
    await ask();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );
    expect(screen.getByTestId('text')).toHaveTextContent('You ordered ORD-1.');
  });
});

describe('a change the rest of the site can see', () => {
  // THE MUST PROVE of M4 Task 6. The write already went through the same
  // /api/v1 a manual action does; what is stale is the server-rendered
  // page AROUND the panel -- exactly the staleness cart-view.tsx fixes
  // for its own buttons with router.refresh().
  const refresh = jest.fn();

  beforeEach(() => {
    refresh.mockReset();
    jest
      .spyOn(require('next/navigation'), 'useRouter')
      .mockReturnValue({ refresh } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function turnUsing(tool: string, ok: boolean) {
    return (
      `event: assistant\ndata: {"v":1,"seq":0,"type":"tool_started","data":{"call_id":"c1","tool":"${tool}","arguments":{}}}\n\n` +
      `event: assistant\ndata: {"v":1,"seq":1,"type":"tool_completed","data":{"call_id":"c1","tool":"${tool}","ok":${ok},"result":{}}}\n\n` +
      'event: assistant\ndata: {"v":1,"seq":2,"type":"message","data":{"text":"Done."}}\n\n'
    );
  }

  it('refreshes the page after the assistant changes the cart', async () => {
    global.fetch = jest.fn().mockResolvedValue(streamOf(turnUsing('add_to_cart', true)));
    renderProbe();
    await ask();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('refreshes after an order is cancelled', async () => {
    global.fetch = jest.fn().mockResolvedValue(streamOf(turnUsing('cancel_order', true)));
    renderProbe();
    await ask();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('does NOT refresh after a read-only turn', async () => {
    // A refresh re-renders every server component on the page. Doing it
    // after "what did I order?" would make every question cost one for
    // no change at all.
    global.fetch = jest.fn().mockResolvedValue(streamOf(turnUsing('get_orders', true)));
    renderProbe();
    await ask();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does NOT refresh when the change failed', async () => {
    // Nothing changed, so nothing is stale.
    global.fetch = jest
      .fn()
      .mockResolvedValue(streamOf(turnUsing('add_to_cart', false)));
    renderProbe();
    await ask();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('after signing out', () => {
  it('holds no conversation when the customer is no longer signed in', async () => {
    // "The previous customer's conversation is still on screen" is exactly
    // the kind of thing nobody checks. Signing out navigates, which
    // remounts this provider; its mount request then 401s, and it must
    // come up empty rather than showing whatever it had.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ error: 'Authentication required' }),
    } as unknown as Response);

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );
    expect(screen.getByTestId('text')).toHaveTextContent('');
  });
});
