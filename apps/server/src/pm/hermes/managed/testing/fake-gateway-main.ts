/**
 * The fake Hermes gateway as a process (#57): what the managed engine starts
 * in tests where the real one starts `hermes gateway`. It reads what a real
 * gateway reads (`API_SERVER_ENABLED`, `API_SERVER_KEY`, `API_SERVER_HOST`,
 * `API_SERVER_PORT`, `HERMES_HOME`) and refuses to start as Hermes does: no
 * key, or one shorter than 16 characters, ends it with an error.
 *
 * So that a test can see what it was started with, it writes into its home:
 *   fake-start.json     the environment it got and `config.yaml` as it found it
 *   fake-sessions.json  its sessions, read back at the next start, as Hermes
 *                       keeps its own in `state.db`
 *
 * A message whose text is `fake:crash` ends the process with exit code 7 and
 * a last line that holds its API key, as a careless program would print it.
 * `FAKE_HERMES_EXIT=<code>` ends it right at the start, `FAKE_HERMES_SLOW_MS`
 * delays listening, `FAKE_HERMES_DEAF=1` never listens.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FakeHermesGateway, type FakeSession } from "../../testing/fake-gateway.ts";

const env = process.env;
const home = env.HERMES_HOME ?? "";
const key = env.API_SERVER_KEY ?? "";

function die(code: number, line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(code);
}

if (!home) die(2, "fake hermes: HERMES_HOME is not set");
mkdirSync(home, { recursive: true });
const configPath = join(home, "config.yaml");
writeFileSync(
  join(home, "fake-start.json"),
  JSON.stringify({
    pid: process.pid,
    env: Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("BUN_"))),
    config: existsSync(configPath) ? readFileSync(configPath, "utf8") : null,
  }),
);

if (env.FAKE_HERMES_EXIT) {
  die(Number(env.FAKE_HERMES_EXIT), `fake hermes: told to exit, key was ${key}`);
}
if (env.API_SERVER_ENABLED !== "true") die(2, "fake hermes: API_SERVER_ENABLED is not true");
if (key.length < 16) die(2, "fake hermes: API_SERVER_KEY must be at least 16 characters");

const gateway = new FakeHermesGateway({
  key,
  port: Number(env.API_SERVER_PORT ?? 8642),
  hostname: env.API_SERVER_HOST ?? "127.0.0.1",
});

const sessionsPath = join(home, "fake-sessions.json");
if (existsSync(sessionsPath)) {
  for (const session of JSON.parse(readFileSync(sessionsPath, "utf8")) as FakeSession[]) {
    gateway.sessions.set(session.id, session);
  }
}
let saved = "";
function save(): void {
  const next = JSON.stringify([...gateway.sessions.values()]);
  if (next !== saved) writeFileSync(sessionsPath, next);
  saved = next;
}

setInterval(() => {
  save();
  if (gateway.received().includes("fake:crash")) {
    // Not again after the restart: the message is taken out of what is kept.
    for (const session of gateway.sessions.values()) {
      session.messages = session.messages.filter((m) => m.content !== "fake:crash");
    }
    save();
    die(7, `fake hermes: fatal: out of cheese (API_SERVER_KEY=${key})`);
  }
}, 15);

if (!env.FAKE_HERMES_DEAF) {
  setTimeout(
    () => {
      gateway.up();
    },
    Number(env.FAKE_HERMES_SLOW_MS ?? 0),
  );
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    save();
    process.exit(0);
  });
}
