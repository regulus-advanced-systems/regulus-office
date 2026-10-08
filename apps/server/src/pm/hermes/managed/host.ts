/**
 * Where a Hermes that the office runs itself lives (#57): the one seam between
 * the managed engine and what actually starts a `hermes gateway` process.
 *
 * - `docker-host.ts`: one container per agent from the pinned Hermes image,
 *   with the agent's own home volume and nothing else mounted.
 * - `testing/process-host.ts`: a local process (the fake gateway) for tests.
 *
 * A host starts and stops processes and keeps each agent's home; it knows
 * nothing about agents, keys or conversations. Whatever it is handed in `env`
 * is secret: it never logs it and never stores it anywhere but the process.
 */

/** What one gateway is started with. */
export interface HermesLaunch {
  agentId: string;
  /** For the gateway process only: the API key the office made up, and the model key. */
  env: Readonly<Record<string, string>>;
  /** Written into the Hermes home before the start (paths relative to it), replacing what is there. */
  files: ReadonlyArray<{ path: string; contents: string }>;
}

/** How a gateway ended. `tail` is raw output and may hold anything: redact before showing. */
export interface HermesExit {
  code: number | null;
  tail: string;
}

export interface HermesProcess {
  /** Base address of the gateway's API server, as the office reaches it. */
  url: string;
  /** Resolves when the process has ended, however it ended. */
  exited: Promise<HermesExit>;
  /** Kill it and whatever it started. Idempotent; the home is kept. */
  stop(): Promise<void>;
}

/** A start that failed for a reason the operator can act on; the message is safe to show. */
export class HermesHostError extends Error {
  override name = "HermesHostError";
}

export interface ManagedHermesHost {
  /**
   * Start a gateway for the agent, replacing one that is still there. It
   * resolves once the process runs, not once it answers: the engine waits for
   * `/health` itself. Throws a {@link HermesHostError} when the office operator has to do something first.
   */
  launch(spec: HermesLaunch): Promise<HermesProcess>;
  /** The agent is gone: remove its process and its home for good. */
  forget(agentId: string): Promise<void>;
  /** After an office restart: stop every gateway left over from before. Homes are kept. */
  reap(): Promise<void>;
}

/** Variables every host sets itself: where the gateway listens and where its home is. */
export const HERMES_ENV = {
  home: "HERMES_HOME",
  host: "API_SERVER_HOST",
  port: "API_SERVER_PORT",
  enabled: "API_SERVER_ENABLED",
  key: "API_SERVER_KEY",
} as const;

/** The port Hermes's API server listens on by default. */
export const HERMES_API_PORT = 8642;

/** How much of a gateway's last output is kept to explain an exit. */
export const TAIL_MAX = 2000;

/** Collect the end of a stream of text without ever holding more than {@link TAIL_MAX}. */
export function tailOf(stream: ReadableStream<Uint8Array> | null | undefined): () => string {
  let tail = "";
  if (stream) {
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for await (const chunk of stream) {
          tail = (tail + decoder.decode(chunk, { stream: true })).slice(-TAIL_MAX);
        }
      } catch {
        // The stream ended with the process.
      }
    })();
  }
  return () => tail;
}
