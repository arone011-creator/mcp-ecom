// lib/assistant/sse.ts
//
// An incremental parser for server-sent events.
//
// It buffers rather than splitting each chunk, because an SSE frame can
// straddle a chunk boundary and a per-chunk split silently loses any
// frame that arrives in two pieces. That failure is intermittent, shows
// up under load, and looks like the agent misbehaving -- which is the
// worst combination to debug. Cheaper to buffer.
//
// Only the fields this system uses are interpreted. `id` and `retry` are
// parsed and ignored on purpose: an unknown field must never make a
// frame unreadable, for the same reason the event contract ignores an
// event type it does not recognise.

export interface SseFrame {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';

  /** Every complete frame this chunk finished. May be empty. */
  push(chunk: string): SseFrame[] {
    // Normalised first, so a CRLF stream and an LF stream parse
    // identically rather than only one of them working.
    this.buffer += chunk.replace(/\r\n/g, '\n');

    const frames: SseFrame[] = [];

    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const frame = parseBlock(block);
      if (frame) frames.push(frame);

      boundary = this.buffer.indexOf('\n\n');
    }

    return frames;
  }
}

function parseBlock(block: string): SseFrame | null {
  // Defaults to "message" per the SSE spec, which is what a producer
  // emitting bare data lines means.
  let event = 'message';
  const data: string[] = [];

  for (const line of block.split('\n')) {
    // A line beginning with a colon is a comment -- keep-alives arrive
    // this way and must not produce a frame.
    if (line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const field = line.slice(0, colon);
    // One optional space after the colon is part of the framing, not the
    // value.
    const value = line.slice(colon + 1).replace(/^ /, '');

    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    // Every other field, known or not, is ignored.
  }

  if (data.length === 0) return null;

  return { event, data: data.join('\n') };
}
