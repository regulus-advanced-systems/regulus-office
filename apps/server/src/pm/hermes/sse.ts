/**
 * Server-sent events as the Hermes API server writes them (#58): frames of
 * `event: <name>` and `data: <json>` lines ended by a blank line, with
 * `: keepalive` comment lines in between that carry nothing.
 */
export interface SseEvent {
  /** `message` when the frame names none. */
  event: string;
  data: string;
}

/** Feed it chunks of text; it returns the frames each chunk completes. */
export class SseParser {
  #buffer = "";

  push(chunk: string): SseEvent[] {
    this.#buffer += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.#buffer);
      if (!match) break;
      const frame = this.#buffer.slice(0, match.index);
      this.#buffer = this.#buffer.slice(match.index + match[0].length);
      const event = parseFrame(frame);
      if (event) out.push(event);
    }
    return out;
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}
