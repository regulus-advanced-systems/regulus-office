/**
 * Hijacked Engine API connections (`POST /exec/{id}/start` with
 * `Upgrade: tcp`). `fetch` cannot hand back the raw socket after a 101, so this
 * speaks just enough HTTP/1.1 over `Bun.connect` (unix socket or TCP, e.g. a
 * docker-socket-proxy) to send one request and then treat the connection as a
 * duplex byte stream: stdin out, stdout/stderr (multiplexed unless TTY) in.
 */
import type { Socket } from "bun";

export type EngineEndpoint =
  | { kind: "unix"; path: string }
  | { kind: "tcp"; hostname: string; port: number };

/** Parse `DOCKER_HOST` (`unix:///path`, `tcp://host:port`, `http://host:port`). */
export function parseDockerHost(host: string): EngineEndpoint {
  if (host.startsWith("unix://")) return { kind: "unix", path: host.slice("unix://".length) };
  const url = URL.parse(host.replace(/^tcp:/, "http:"));
  if (!url || url.protocol !== "http:" || !url.hostname) {
    throw new Error(`unsupported DOCKER_HOST (use unix:// or tcp:// without TLS): ${host}`);
  }
  return { kind: "tcp", hostname: url.hostname, port: Number(url.port || 2375) };
}

export interface RawConnection {
  /** Bytes after the 101 response. Ends when the daemon closes the connection. */
  readonly readable: ReadableStream<Uint8Array>;
  write(data: string | Uint8Array): Promise<void>;
  /** Half-close the write side (EOF on the process's stdin). */
  closeWrite(): void;
  close(): void;
  /** Resolves once the connection is closed either way. */
  readonly closed: Promise<void>;
}

export class HijackError extends Error {
  override name = "HijackError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const HEADER_END = new Uint8Array([13, 10, 13, 10]);

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export async function hijack(
  endpoint: EngineEndpoint,
  path: string,
  body: unknown,
): Promise<RawConnection> {
  const payload = JSON.stringify(body);
  const request =
    `POST ${path} HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\n` +
    `Connection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let socketRef: Socket | undefined;
  let head: Uint8Array = new Uint8Array(0);
  let upgraded = false;
  let finished = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  const { promise: ready, resolve: onReady, reject: onFail } = Promise.withResolvers<void>();
  let pending: Uint8Array[] = [];
  let drained: (() => void) | undefined;

  const readable = new ReadableStream<Uint8Array>(
    {
      start: (c) => void (controller = c),
      pull: () => socketRef?.resume(),
      cancel: () => {
        socketRef?.end();
      },
    },
    { highWaterMark: 64 },
  );

  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    if (!upgraded) onFail(error ?? new HijackError(0, "connection closed before response"));
    try {
      if (error && upgraded) controller.error(error);
      else controller.close();
    } catch {
      // stream already cancelled
    }
    drained?.();
    resolveClosed();
  };

  const onHead = (socket: Socket, chunk: Uint8Array) => {
    const merged = new Uint8Array(head.length + chunk.length);
    merged.set(head);
    merged.set(chunk, head.length);
    head = merged;
    const end = indexOf(head, HEADER_END);
    if (end < 0) return;
    const text = new TextDecoder().decode(head.subarray(0, end));
    const status = Number(text.match(/^HTTP\/1\.[01] (\d{3})/)?.[1] ?? 0);
    const rest = head.subarray(end + 4);
    if (status === 101 || status === 200) {
      upgraded = true;
      onReady();
      if (rest.length > 0) controller.enqueue(rest.slice());
      return;
    }
    // Error responses carry a small JSON body; wait for it (or the close).
    const length = Number(text.match(/content-length:\s*(\d+)/i)?.[1] ?? 0);
    if (rest.length < length) return;
    const message = new TextDecoder().decode(rest.subarray(0, length));
    onFail(new HijackError(status, `${path}: ${status} ${parseMessage(message)}`));
    socket.end();
  };

  const handler = {
    data(socket: Socket, chunk: Uint8Array) {
      if (!upgraded) return onHead(socket, chunk);
      controller.enqueue(chunk);
      if ((controller.desiredSize ?? 1) <= 0) socket.pause();
    },
    drain(socket: Socket) {
      while (pending.length > 0) {
        const next = pending[0] as Uint8Array;
        const n = socket.write(next);
        if (n < next.length) {
          pending[0] = next.subarray(Math.max(n, 0));
          return;
        }
        pending.shift();
      }
      drained?.();
    },
    close: () => finish(),
    end: () => finish(),
    error: (_: Socket, e: Error) => finish(e),
    connectError: (_: Socket, e: Error) => finish(e),
  };
  const socket =
    endpoint.kind === "unix"
      ? await Bun.connect({ unix: endpoint.path, allowHalfOpen: true, socket: handler })
      : await Bun.connect({
          hostname: endpoint.hostname,
          port: endpoint.port,
          allowHalfOpen: true,
          socket: handler,
        });
  socketRef = socket;

  const write = async (data: string | Uint8Array): Promise<void> => {
    if (finished) throw new Error("connection closed");
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (pending.length > 0) pending.push(bytes);
    else {
      const n = socket.write(bytes);
      if (n < bytes.length) pending.push(bytes.subarray(Math.max(n, 0)));
    }
    while (pending.length > 0 && !finished) {
      await new Promise<void>((r) => (drained = r));
    }
  };

  await write(request);
  await ready;
  return {
    readable,
    write,
    // Bun's shutdown() without an argument is shutdown(SHUT_WR); with
    // allowHalfOpen the read side stays open for the remaining output.
    closeWrite: () => socket.shutdown(),
    close: () => {
      pending = [];
      socket.end();
    },
    closed,
  };
}

function parseMessage(body: string): string {
  try {
    return (JSON.parse(body) as { message?: string }).message ?? body;
  } catch {
    return body.trim();
  }
}
