/**
 * Graceful shutdown: subsystems register a stop hook; the first SIGINT/SIGTERM
 * runs hooks in reverse registration order with a deadline, a second signal
 * (or the deadline) forces exit.
 */
import type { Logger } from "./logging.ts";

export type ShutdownHook = () => void | Promise<void>;

export interface ShutdownController {
  /** Registers a hook; hooks run last-registered-first. Returns an unregister function. */
  register(name: string, hook: ShutdownHook): () => void;
  /** Runs all hooks once. Resolves true if every hook finished before the deadline. */
  shutdown(reason: string): Promise<boolean>;
  readonly shuttingDown: boolean;
}

export interface ShutdownOptions {
  logger: Logger;
  /** Milliseconds to wait for hooks before giving up. */
  timeoutMs: number;
}

export function createShutdownController(options: ShutdownOptions): ShutdownController {
  const { logger, timeoutMs } = options;
  const hooks: { name: string; hook: ShutdownHook }[] = [];
  let pending: Promise<boolean> | undefined;

  const runHooks = async (): Promise<void> => {
    for (const { name, hook } of [...hooks].reverse()) {
      try {
        await hook();
        logger.debug({ hook: name }, "shutdown hook finished");
      } catch (err) {
        logger.error({ hook: name, err }, "shutdown hook failed");
      }
    }
  };

  return {
    get shuttingDown() {
      return pending !== undefined;
    },
    register(name, hook) {
      const entry = { name, hook };
      hooks.push(entry);
      return () => {
        const i = hooks.indexOf(entry);
        if (i >= 0) hooks.splice(i, 1);
      };
    },
    shutdown(reason) {
      if (pending) return pending;
      logger.info({ reason, timeoutMs }, "shutting down");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<false>((res) => {
        timer = setTimeout(() => res(false), timeoutMs);
      });
      pending = Promise.race([runHooks().then(() => true as const), deadline]).then((clean) => {
        clearTimeout(timer);
        if (clean) logger.info("shutdown complete");
        else logger.warn({ timeoutMs }, "shutdown deadline reached; forcing exit");
        return clean;
      });
      return pending;
    },
  };
}

/**
 * Wires SIGINT/SIGTERM to the controller. First signal: graceful; second: immediate exit.
 * Returns a function that removes the listeners (tests).
 */
export function installSignalHandlers(
  controller: ShutdownController,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  const onSignal = (signal: NodeJS.Signals) => {
    if (controller.shuttingDown) {
      exit(130);
      return;
    }
    void controller.shutdown(signal).then((clean) => exit(clean ? 0 : 1));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
}
