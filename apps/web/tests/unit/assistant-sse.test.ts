// tests/unit/assistant-sse.test.ts
//
// An SSE frame can straddle a chunk boundary. Splitting each chunk on a
// blank line loses any frame that arrives in two pieces -- intermittently,
// under load, in production, which is the failure mode hardest to
// reproduce and easiest to blame on the model. This parser buffers
// instead, and these tests feed it deliberately nasty splits.

import { SseParser } from '@/lib/assistant/sse';

function feed(parser: SseParser, chunks: string[]) {
  return chunks.flatMap((chunk) => parser.push(chunk));
}

describe('SseParser', () => {
  it('reads one whole frame', () => {
    const frames = feed(new SseParser(), ['event: assistant\ndata: {"a":1}\n\n']);

    expect(frames).toEqual([{ event: 'assistant', data: '{"a":1}' }]);
  });

  it('reads several frames from one chunk', () => {
    const frames = feed(new SseParser(), [
      'event: control\ndata: {"t":1}\n\nevent: assistant\ndata: {"a":2}\n\n',
    ]);

    expect(frames.map((f) => f.event)).toEqual(['control', 'assistant']);
  });

  it('joins a frame split across two chunks', () => {
    const frames = feed(new SseParser(), ['event: assistant\ndata: {"a"', ':1}\n\n']);

    expect(frames).toEqual([{ event: 'assistant', data: '{"a":1}' }]);
  });

  it('joins a frame split on the blank line itself', () => {
    const frames = feed(new SseParser(), ['event: assistant\ndata: {}\n', '\n']);

    expect(frames).toHaveLength(1);
  });

  it('survives being fed one byte at a time', () => {
    // The worst case, and the one a naive splitter fails hardest on.
    const wire = 'event: assistant\ndata: {"a":1}\n\nevent: control\ndata: {}\n\n';
    const frames = feed(new SseParser(), wire.split(''));

    expect(frames.map((f) => f.event)).toEqual(['assistant', 'control']);
    expect(frames[0].data).toBe('{"a":1}');
  });

  it('defaults a frame with no event line to "message"', () => {
    // The SSE default, and what an agent emitting bare data would send.
    expect(feed(new SseParser(), ['data: hi\n\n'])).toEqual([
      { event: 'message', data: 'hi' },
    ]);
  });

  it('ignores comments and unknown fields rather than choking', () => {
    const frames = feed(new SseParser(), [
      ': keep-alive\n\nid: 7\nevent: assistant\ndata: {}\n\n',
    ]);

    expect(frames).toEqual([{ event: 'assistant', data: '{}' }]);
  });

  it('joins multiple data lines with a newline, as the spec says', () => {
    const frames = feed(new SseParser(), ['event: assistant\ndata: a\ndata: b\n\n']);

    expect(frames[0].data).toBe('a\nb');
  });

  it('holds an incomplete trailing frame rather than emitting half of it', () => {
    const parser = new SseParser();

    expect(parser.push('event: assistant\ndata: {"a"')).toEqual([]);
  });

  it('tolerates CRLF line endings', () => {
    const frames = feed(new SseParser(), [
      'event: assistant\r\ndata: {"a":1}\r\n\r\n',
    ]);

    expect(frames).toEqual([{ event: 'assistant', data: '{"a":1}' }]);
  });
});
