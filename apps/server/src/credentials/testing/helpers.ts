/**
 * Fixtures for the credential panel tests: an office with real auth, the
 * panel's routes, a capturing pino logger, a fresh master key and a fake
 * provider API that answers list-models calls. Nothing here is a real key.
 */
import { join } from "node:path";
import { AdapterRegistry, ClaudeCodeAdapter, CodexAdapter } from "@regulus/agent-adapters";
import type { KeyPresetId, UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { startOffice } from "../../auth/test-helpers.ts";
import { auditLog, userProfiles } from "../../db/schema/index.ts";
import { createLogger } from "../../logging.ts";
import type { Runner } from "../../runners/types.ts";
import type { MasterKeyring } from "../../secrets/index.ts";
import { freshKey, keyringOf } from "../../secrets/test-helpers.ts";
import { LoginSessionTargets } from "../../terminals/login-sessions.ts";
import type { CliCommands } from "../cli-status.ts";
import { mountCredentialPanel } from "../panel.ts";
import { createKeyVerifier } from "../verify.ts";

export const FAKE_CLAUDE = join(import.meta.dir, "fake-claude.sh");
export const FAKE_APP_SERVER = join(
  import.meta.dir,
  "../../../../../packages/agent-adapters/src/codex/testing/fake-app-server-main.ts",
);
export const RECORDED_TRACES = join(
  import.meta.dir,
  "../../../../../packages/agent-adapters/src/codex/fixtures/recorded",
);
export const trace = (name: string) => join(import.meta.dir, name);

/** `bun fake-app-server-main.ts <trace>`, standing in for `codex`. */
export const fakeCodex = (tracePath: string): string[] => [
  process.execPath,
  FAKE_APP_SERVER,
  tracePath,
];

export const GOOD_KEY = "sk-FAKE-good-key-0123456789abcdef";
export const OTHER_GOOD_KEY = "sk-FAKE-other-good-key-9876543210";
export const BAD_KEY = "sk-FAKE-wrong-key-00000000000000";
export const SLOW_KEY = "sk-FAKE-slow-key-111111111111111";
export const BODY_MARK = "FAKE-PROVIDER-RESPONSE-BODY";

export interface FakeProviderCall {
  path: string;
  headers: Record<string, string>;
}

/** Answers every GET: 200 for the good keys, 401 for others, a hang for SLOW_KEY. */
export function startFakeProvider() {
  const calls: FakeProviderCall[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const headers = Object.fromEntries(request.headers.entries());
      calls.push({ path: new URL(request.url).pathname, headers });
      const presented = `${headers.authorization ?? ""}${headers["x-api-key"] ?? ""}${headers["x-goog-api-key"] ?? ""}`;
      if (presented.includes(SLOW_KEY)) await Bun.sleep(2_000);
      if (presented.includes(GOOD_KEY) || presented.includes(OTHER_GOOD_KEY)) {
        return Response.json({ data: [{ id: BODY_MARK }] });
      }
      return Response.json({ error: BODY_MARK }, { status: 401 });
    },
  });
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  return { server, calls, url, stop: () => server.stop(true) };
}

export interface CredentialOfficeOptions {
  keyring?: MasterKeyring | null;
  runner?: Runner;
  commands?: CliCommands;
  codexCommand?: string[];
  providerUrl?: (path: string) => string;
  /** Default: generous limits; pass `"default"` for the production ones. */
  limits?: "default";
}

const GENEROUS = { capacity: 1000, refillPerSecond: 1000 };

const unusedRunner = new Proxy({} as Runner, {
  get: () => () => Promise.reject(new Error("no runner in this test")),
});

export function startCredentialOffice(options: CredentialOfficeOptions = {}) {
  const office = startOffice();
  const lines: string[] = [];
  const logger = createLogger({
    level: "debug",
    destination: { write: (line: string) => void lines.push(line) },
  });
  const keyring =
    options.keyring === null
      ? undefined
      : (options.keyring ?? { current: 1, keys: keyringOf({ 1: freshKey() }) });
  const urls: Partial<Record<KeyPresetId, string>> = {};
  if (options.providerUrl) {
    for (const preset of ["anthropic", "openai", "gemini", "deepseek", "zai", "kimi"] as const) {
      urls[preset] = options.providerUrl(`/${preset}/models`);
    }
  }
  const logins = new LoginSessionTargets();
  const adapters = new AdapterRegistry([
    new ClaudeCodeAdapter({ command: options.commands?.claude ?? FAKE_CLAUDE }),
    new CodexAdapter({ command: options.codexCommand ?? ["false"] }),
  ]);
  const panel = mountCredentialPanel(office.server.router, {
    db: office.db,
    auth: office.auth,
    keyring,
    runner: options.runner ?? unusedRunner,
    adapters,
    logins,
    officeUrl: "http://127.0.0.1",
    logger,
    verify: createKeyVerifier({ urls, timeoutMs: 300 }),
    commands: options.commands,
    limits: options.limits === "default" ? {} : { verify: GENEROUS, loginStart: GENEROUS },
  });

  const setRole = (userId: string, role: UserRole) =>
    office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, userId)).run();

  const user = async (name: string, role: UserRole = "member") => {
    const u = await office.signUp(name);
    if (role !== "member") setRole(u.id, role);
    return u;
  };

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    office.request(path, {
      method,
      cookie,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const audit = () => office.db.select().from(auditLog).all();

  return {
    ...office,
    panel,
    logins,
    adapters,
    keyring,
    lines,
    user,
    send,
    audit,
    async stop() {
      await panel.shutdown();
      await office.stop();
    },
  };
}

export type CredentialOffice = ReturnType<typeof startCredentialOffice>;
