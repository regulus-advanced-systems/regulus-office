/**
 * Thin Docker Engine API client (no docker CLI, no SDK): `fetch` with Bun's
 * `unix` option for the local socket, plain HTTP for `tcp://` (e.g. the
 * docker-socket-proxy from #95), and `hijack` for interactive exec streams.
 *
 * Endpoints used, for socket-proxy allowlists: `_ping`, `containers/*`
 * (create, json, start, delete), `containers/{id}/exec`, `exec/{id}/start|resize|json`,
 * `volumes/create`, `volumes/{name}` (delete), `images/create` (pull); all
 * within the deploy/ socket-proxy allowlist (#95). No archive endpoints: files
 * are written through exec stdin. Tests additionally use `build` and image
 * delete against the local socket.
 */

import { type EngineEndpoint, hijack, parseDockerHost, type RawConnection } from "./hijack.ts";
import { demuxAll } from "./mux.ts";

/** Subpath volume mounts need API 1.45 (Docker Engine 26). */
export const API_VERSION = "v1.45";

export class DockerApiError extends Error {
  override name = "DockerApiError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  body?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExecOptions {
  cmd: readonly string[];
  /** `NAME=value` entries for this exec only (not stored on the container). */
  env?: readonly string[];
  user?: string;
  workdir?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface InteractiveExecOptions extends ExecOptions {
  tty: boolean;
  /** `[rows, cols]` for TTY execs. */
  consoleSize?: [number, number];
}

export interface InteractiveExec {
  id: string;
  conn: RawConnection;
}

export class EngineClient {
  readonly endpoint: EngineEndpoint;
  readonly #base: string;

  constructor(dockerHost = process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock") {
    this.endpoint = parseDockerHost(dockerHost);
    this.#base =
      this.endpoint.kind === "unix"
        ? "http://docker"
        : `http://${this.endpoint.hostname}:${this.endpoint.port}`;
  }

  /** True when the daemon answers `/_ping` within `timeoutMs`. */
  async ping(timeoutMs = 2000): Promise<boolean> {
    try {
      const res = await this.request("GET", "/_ping", { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const url = new URL(`${this.#base}/${API_VERSION}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      headers["content-type"] = opts.contentType ?? "application/octet-stream";
      body = new Blob([opts.body as Uint8Array<ArrayBuffer>]);
    }
    const init: RequestInit & { unix?: string } = { method, headers, body, signal: opts.signal };
    if (this.endpoint.kind === "unix") init.unix = this.endpoint.path;
    return fetch(url, init);
  }

  /** Request and parse JSON; non-2xx throws {@link DockerApiError} with the daemon's message. */
  async json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(method, path, opts);
    await this.#check(res, method, path);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Request and discard the body; non-2xx throws. */
  async call(method: string, path: string, opts: RequestOptions = {}): Promise<void> {
    const res = await this.request(method, path, opts);
    await this.#check(res, method, path);
    await res.arrayBuffer();
  }

  /**
   * Run a command to completion inside a container.
   *
   * The start request has no body: an empty body means `{Detach: false, Tty: false}` to the
   * daemon, and a body breaks this call through docker-socket-proxy now and then (#127). The
   * proxy (Go `httputil.ReverseProxy`) closes the request body as soon as it starts streaming
   * the daemon's answer, which can be before its transport has finished with that body; the
   * transport then drops the daemon connection mid-output and the proxy aborts ours ("socket
   * connection was closed unexpectedly"). Hijacked starts (`execInteractive`) are not affected.
   */
  async exec(containerId: string, opts: ExecOptions): Promise<ExecResult> {
    const id = await this.#createExec(containerId, { ...opts, tty: false }, false);
    const res = await this.request("POST", `/exec/${id}/start`);
    await this.#check(res, "POST", `/exec/${id}/start`);
    const { stdout, stderr } = demuxAll(new Uint8Array(await res.arrayBuffer()));
    return { code: await this.execExitCode(id), stdout, stderr };
  }

  /** Start an exec with stdin attached and return the hijacked connection. */
  async execInteractive(
    containerId: string,
    opts: InteractiveExecOptions,
  ): Promise<InteractiveExec> {
    const id = await this.#createExec(containerId, opts, true);
    const conn = await hijack(this.endpoint, `/${API_VERSION}/exec/${id}/start`, {
      Detach: false,
      Tty: opts.tty,
      ...(opts.consoleSize ? { ConsoleSize: opts.consoleSize } : {}),
    });
    return { id, conn };
  }

  /** Exit code of a finished exec; waits briefly for the daemon to record it. */
  async execExitCode(id: string): Promise<number> {
    for (let i = 0; ; i++) {
      const info = await this.json<{ Running: boolean; ExitCode: number | null }>(
        "GET",
        `/exec/${id}/json`,
      );
      if (!info.Running && info.ExitCode !== null) return info.ExitCode;
      if (i > 200) throw new DockerApiError(0, `exec ${id} did not finish`);
      await Bun.sleep(10);
    }
  }

  async resizeExec(id: string, rows: number, cols: number): Promise<void> {
    await this.call("POST", `/exec/${id}/resize`, { query: { h: rows, w: cols } });
  }

  /**
   * Run a command to completion with `input` on its stdin. The command must stop
   * reading on its own (e.g. `head -c <n>`): stdin is never half-closed, because
   * a docker-socket-proxy in between tears the whole hijacked connection down on
   * client EOF.
   */
  async execWithInput(
    containerId: string,
    opts: ExecOptions,
    input: Uint8Array,
  ): Promise<ExecResult> {
    const { id, conn } = await this.execInteractive(containerId, { ...opts, tty: false });
    const collected = new Response(conn.readable).arrayBuffer();
    if (input.byteLength > 0) await conn.write(input);
    const { stdout, stderr } = demuxAll(new Uint8Array(await collected));
    return { code: await this.execExitCode(id), stdout, stderr };
  }

  async #createExec(
    containerId: string,
    opts: InteractiveExecOptions,
    stdin: boolean,
  ): Promise<string> {
    const created = await this.json<{ Id: string }>("POST", `/containers/${containerId}/exec`, {
      json: {
        Cmd: opts.cmd,
        Env: opts.env ?? [],
        User: opts.user,
        WorkingDir: opts.workdir,
        AttachStdin: stdin,
        AttachStdout: true,
        AttachStderr: true,
        Tty: opts.tty,
        ...(opts.consoleSize ? { ConsoleSize: opts.consoleSize } : {}),
      },
    });
    return created.Id;
  }

  async #check(res: Response, method: string, path: string): Promise<void> {
    if (res.ok) return;
    const text = await res.text();
    let message = text.trim();
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      // not JSON
    }
    throw new DockerApiError(res.status, `${method} ${path}: ${res.status} ${message}`);
  }
}
