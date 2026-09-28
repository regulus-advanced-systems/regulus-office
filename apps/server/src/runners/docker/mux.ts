/**
 * Docker's multiplexed stdio framing (non-TTY exec/attach): each frame is an
 * 8-byte header `[stream, 0, 0, 0, size (uint32 BE)]` followed by `size` bytes,
 * where stream 1 is stdout and 2 is stderr (0, stdin, is never sent back).
 */

export const STDOUT = 1;
export const STDERR = 2;

/** Encode one frame (used by tests and the fake Engine server). */
export function frame(stream: number, data: string | Uint8Array): Uint8Array {
  const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const out = new Uint8Array(8 + body.byteLength);
  out[0] = stream;
  new DataView(out.buffer).setUint32(4, body.byteLength);
  out.set(body, 8);
  return out;
}

/** Incremental frame parser: feed chunks, get `(stream, payload)` callbacks. */
export class FrameParser {
  #buf = new Uint8Array(0);

  constructor(private readonly onFrame: (stream: number, payload: Uint8Array) => void) {}

  push(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.#buf.byteLength + chunk.byteLength);
    merged.set(this.#buf);
    merged.set(chunk, this.#buf.byteLength);
    let at = 0;
    while (merged.byteLength - at >= 8) {
      const size = new DataView(merged.buffer, merged.byteOffset + at).getUint32(4);
      if (merged.byteLength - at - 8 < size) break;
      this.onFrame(merged[at] ?? 0, merged.slice(at + 8, at + 8 + size));
      at += 8 + size;
    }
    this.#buf = merged.slice(at);
  }
}

/** Split a multiplexed stream into stdout and stderr streams. */
export function demux(source: ReadableStream<Uint8Array>): {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
} {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  let err!: ReadableStreamDefaultController<Uint8Array>;
  const stdout = new ReadableStream<Uint8Array>({ start: (c) => void (out = c) });
  const stderr = new ReadableStream<Uint8Array>({ start: (c) => void (err = c) });
  const parser = new FrameParser((stream, payload) => {
    if (stream === STDOUT) out.enqueue(payload);
    else if (stream === STDERR) err.enqueue(payload);
  });
  (async () => {
    try {
      for await (const chunk of source) parser.push(chunk);
      out.close();
      err.close();
    } catch (e) {
      out.error(e);
      err.error(e);
    }
  })();
  return { stdout, stderr };
}

/** Collect a whole multiplexed body into stdout/stderr strings. */
export function demuxAll(body: Uint8Array): { stdout: string; stderr: string } {
  const decoder = { out: new TextDecoder(), err: new TextDecoder() };
  let stdout = "";
  let stderr = "";
  new FrameParser((stream, payload) => {
    if (stream === STDOUT) stdout += decoder.out.decode(payload, { stream: true });
    else if (stream === STDERR) stderr += decoder.err.decode(payload, { stream: true });
  }).push(body);
  return { stdout: stdout + decoder.out.decode(), stderr: stderr + decoder.err.decode() };
}
