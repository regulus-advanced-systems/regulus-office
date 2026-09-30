/**
 * Fake Docker Engine API server for unit tests: a raw HTTP/1.1 listener on a
 * unix socket (so both `fetch` and hijacked `Upgrade: tcp` execs work), with
 * in-memory containers, volumes and execs. Exec behaviour is supplied by the
 * test (`onExec`), which sees the command, env and stdin of every exec.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket, UnixSocketListener } from "bun";
import { frame, STDERR, STDOUT } from "../mux.ts";

export interface FakeExec {
  id: string;
  containerId: string;
  cmd: string[];
  env: string[];
  tty: boolean;
  stdin: boolean;
}

export interface ExecIo {
  /** Bytes the client sent on stdin so far; `readStdin(n)` waits for n. */
  readStdin(n: number): Promise<Uint8Array>;
  stdout(data: string | Uint8Array): void;
  stderr(data: string | Uint8Array): void;
}

export type ExecHandler = (exec: FakeExec, io: ExecIo) => Promise<number> | number;

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
}

export interface FakeContainer {
  id: string;
  name: string;
  running: boolean;
  body: Record<string, unknown>;
  /** Id of the image it was created from. */
  imageId?: string;
  /** Docker state override, e.g. `dead` (default: running / exited). */
  status?: string;
}

/** An Engine API error answer the test injects. */
export interface FakeFailure {
  status: number;
  message: string;
}

interface Conn {
  buf: Uint8Array;
  stdin?: { chunks: Uint8Array[]; wake?: () => void };
}

export class FakeEngine {
  readonly requests: RecordedRequest[] = [];
  readonly containers = new Map<string, FakeContainer>();
  readonly volumes = new Map<string, Record<string, unknown>>();
  readonly execs = new Map<string, FakeExec & { exitCode: number | null }>();
  readonly images = new Set<string>();
  /** Image id per tag; a tag without one gets `sha256:<tag>`. Change it to "rebuild" the image. */
  readonly imageIds = new Map<string, string>();
  onExec: ExecHandler = () => 0;
  /** Makes `POST /containers/{id}/start` fail (e.g. the RWLayer 500 of #151). */
  onStart: (c: FakeContainer) => FakeFailure | undefined = () => undefined;
  /** `POST /containers/{id}/wait`: runs the container "to completion", returns its exit code. */
  onWait: (c: FakeContainer) => number | Promise<number> = () => 0;
  /** Makes `GET /containers/{id}/json` fail. */
  onInspect: (c: FakeContainer) => FakeFailure | undefined = () => undefined;
  /**
   * How long a container create takes. Like the real daemon, the name is reserved at once
   * (a second create of it gets 409) but inspecting it answers 404 until the create is done.
   */
  createDelayMs = 0;
  readonly #reserved = new Set<string>();
  #seq = 0;

  private constructor(
    readonly dir: string,
    readonly socketPath: string,
    private listener?: UnixSocketListener<Conn>,
  ) {}

  static async start(): Promise<FakeEngine> {
    const dir = await mkdtemp(join(tmpdir(), "rgo-fake-docker-"));
    const engine = new FakeEngine(dir, join(dir, "docker.sock"));
    engine.listener = Bun.listen<Conn>({
      unix: engine.socketPath,
      allowHalfOpen: true,
      socket: {
        open: (s) => void (s.data = { buf: new Uint8Array(0) }),
        data: (s, chunk) => engine.#onData(s, chunk),
      },
    });
    return engine;
  }

  get dockerHost(): string {
    return `unix://${this.socketPath}`;
  }

  async stop(): Promise<void> {
    this.listener?.stop(true);
    await rm(this.dir, { recursive: true, force: true });
  }

  /** Requests matching `method path` (path compared without the API version). */
  calls(method: string, path: string | RegExp): RecordedRequest[] {
    return this.requests.filter(
      (r) =>
        r.method === method && (typeof path === "string" ? r.path === path : path.test(r.path)),
    );
  }

  imageId(tag: string): string {
    return this.imageIds.get(tag) ?? `sha256:${tag}`;
  }

  #id(): string {
    return `${++this.#seq}`.padStart(12, "0");
  }

  #onData(s: Socket<Conn>, chunk: Uint8Array) {
    const conn = s.data;
    if (conn.stdin) {
      conn.stdin.chunks.push(chunk.slice());
      conn.stdin.wake?.();
      return;
    }
    const merged = new Uint8Array(conn.buf.length + chunk.length);
    merged.set(conn.buf);
    merged.set(chunk, conn.buf.length);
    conn.buf = merged;
    const text = new TextDecoder().decode(merged);
    const end = text.indexOf("\r\n\r\n");
    if (end < 0) return;
    const head = text.slice(0, end);
    const length = Number(head.match(/content-length:\s*(\d+)/i)?.[1] ?? 0);
    const bodyBytes = merged.subarray(Buffer.byteLength(text.slice(0, end + 4)));
    if (bodyBytes.length < length) return;
    conn.buf = new Uint8Array(0);
    const [method = "", rawPath = ""] = head.split(" ");
    const url = new URL(rawPath, "http://docker");
    const req: RecordedRequest = {
      method,
      path: url.pathname.replace(/^\/v1\.\d+/, ""),
      query: url.searchParams,
      body: new TextDecoder().decode(bodyBytes.subarray(0, length)),
    };
    this.requests.push(req);
    const upgrade = /upgrade:\s*tcp/i.test(head);
    void this.#route(s, req, upgrade);
  }

  #reply(s: Socket<Conn>, status: number, body: unknown = "", type = "application/json") {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const bytes = new TextEncoder().encode(text);
    s.write(
      `HTTP/1.1 ${status} X\r\nContent-Type: ${type}\r\nContent-Length: ${bytes.length}\r\n` +
        "Connection: close\r\n\r\n",
    );
    s.write(bytes);
    s.end();
  }

  #container(ref: string): FakeContainer | undefined {
    return this.containers.get(ref) ?? [...this.containers.values()].find((c) => c.name === ref);
  }

  async #route(s: Socket<Conn>, req: RecordedRequest, upgrade: boolean) {
    const body = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
    const m = (re: RegExp) => req.path.match(re);
    let hit: RegExpMatchArray | null;
    if (req.method === "GET" && req.path === "/_ping")
      return this.#reply(s, 200, "OK", "text/plain");
    if (req.method === "POST" && req.path === "/volumes/create") {
      this.volumes.set(String(body.Name), body);
      return this.#reply(s, 201, { Name: body.Name });
    }
    if (req.method === "DELETE" && (hit = m(/^\/volumes\/([^/]+)$/))) {
      const found = this.volumes.delete(hit[1] ?? "");
      return this.#reply(s, found ? 204 : 404, found ? "" : { message: "no such volume" });
    }
    if (req.method === "GET" && (hit = m(/^\/images\/(.+)\/json$/))) {
      const tag = hit[1] ?? "";
      if (!this.images.has(tag)) return this.#reply(s, 404, { message: `No such image: ${tag}` });
      return this.#reply(s, 200, { Id: this.imageId(tag) });
    }
    if (req.method === "POST" && req.path === "/images/create") {
      this.images.add(req.query.get("fromImage") ?? "");
      return this.#reply(s, 200, '{"status":"pulled"}\n');
    }
    if (req.method === "POST" && req.path === "/containers/create") {
      const name = req.query.get("name") ?? "";
      if (!this.images.has(String(body.Image)))
        return this.#reply(s, 404, { message: "No such image" });
      if (this.#container(name) || this.#reserved.has(name)) {
        return this.#reply(s, 409, {
          message: `Conflict. The container name "/${name}" is in use`,
        });
      }
      const id = `c${this.#id()}`;
      if (this.createDelayMs > 0) {
        this.#reserved.add(name);
        await Bun.sleep(this.createDelayMs);
        this.#reserved.delete(name);
      }
      const imageId = this.imageId(String(body.Image));
      this.containers.set(id, { id, name, running: false, body, imageId });
      return this.#reply(s, 201, { Id: id });
    }
    if (req.method === "GET" && req.path === "/containers/json") {
      const filters = JSON.parse(req.query.get("filters") ?? "{}") as Record<string, string[]>;
      const labels = (c: FakeContainer) => (c.body.Labels ?? {}) as Record<string, string>;
      const rows = [...this.containers.values()]
        .filter((c) =>
          (filters.label ?? []).every((f) => {
            const [k = "", v] = f.split("=");
            return v === undefined ? k in labels(c) : labels(c)[k] === v;
          }),
        )
        .filter((c) => (filters.name ?? []).every((n) => new RegExp(n).test(`/${c.name}`)))
        .map((c) => ({
          Id: c.id,
          Names: [`/${c.name}`],
          Labels: c.body.Labels,
          State: this.#status(c),
        }));
      return this.#reply(s, 200, rows);
    }
    if ((hit = m(/^\/containers\/([^/]+)(?:\/(json|start|exec|wait))?$/))) {
      const c = this.#container(hit[1] ?? "");
      if (!c) return this.#reply(s, 404, { message: "No such container" });
      const action = hit[2];
      if (req.method === "DELETE") {
        this.containers.delete(c.id);
        return this.#reply(s, 204);
      }
      if (action === "json") {
        const failure = this.onInspect(c);
        if (failure) return this.#reply(s, failure.status, { message: failure.message });
        return this.#reply(s, 200, {
          Id: c.id,
          Image: c.imageId,
          State: { Running: c.running, Status: this.#status(c) },
          Config: { Labels: c.body.Labels },
          HostConfig: c.body.HostConfig,
        });
      }
      if (action === "wait") {
        const StatusCode = await this.onWait(c);
        c.running = false;
        return this.#reply(s, 200, { StatusCode });
      }
      if (action === "start") {
        const failure = c.running ? undefined : this.onStart(c);
        if (failure) return this.#reply(s, failure.status, { message: failure.message });
        const was = c.running;
        c.running = true;
        return this.#reply(s, was ? 304 : 204);
      }
      if (action === "exec") {
        if (!c.running) return this.#reply(s, 409, { message: "not running" });
        const id = `e${this.#id()}`;
        this.execs.set(id, {
          id,
          containerId: c.id,
          cmd: body.Cmd as string[],
          env: (body.Env as string[]) ?? [],
          tty: Boolean(body.Tty),
          stdin: Boolean(body.AttachStdin),
          exitCode: null,
        });
        return this.#reply(s, 201, { Id: id });
      }
    }
    if ((hit = m(/^\/exec\/([^/]+)\/(start|json|resize)$/))) {
      const exec = this.execs.get(hit[1] ?? "");
      if (!exec) return this.#reply(s, 404, { message: "No such exec" });
      if (hit[2] === "json") {
        return this.#reply(s, 200, { Running: exec.exitCode === null, ExitCode: exec.exitCode });
      }
      if (hit[2] === "resize") return this.#reply(s, 200);
      return this.#runExec(s, exec, upgrade);
    }
    return this.#reply(s, 404, { message: `fake engine: no route for ${req.method} ${req.path}` });
  }

  #status(c: FakeContainer): string {
    return c.running ? "running" : (c.status ?? "exited");
  }

  async #runExec(s: Socket<Conn>, exec: FakeExec & { exitCode: number | null }, upgrade: boolean) {
    const out: Uint8Array[] = [];
    const emit = (stream: number, data: string | Uint8Array) => {
      const bytes = exec.tty
        ? typeof data === "string"
          ? new TextEncoder().encode(data)
          : data
        : frame(stream, data);
      if (upgrade) s.write(bytes);
      else out.push(bytes);
    };
    const stdin: { chunks: Uint8Array[]; wake?: () => void } = { chunks: [] };
    if (upgrade) {
      s.write("HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
      s.data.stdin = stdin;
    }
    const io: ExecIo = {
      async readStdin(n) {
        for (;;) {
          const all = Buffer.concat(stdin.chunks);
          if (all.length >= n) return new Uint8Array(all.subarray(0, n));
          await new Promise<void>((r) => (stdin.wake = r));
        }
      },
      stdout: (d) => emit(STDOUT, d),
      stderr: (d) => emit(STDERR, d),
    };
    const code = await this.onExec(exec, io);
    exec.exitCode = code;
    if (upgrade) {
      s.end();
      return;
    }
    const body = Buffer.concat(out);
    s.write(
      `HTTP/1.1 200 OK\r\nContent-Type: application/vnd.docker.multiplexed-stream\r\n` +
        `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
    );
    s.write(body);
    s.end();
  }
}
