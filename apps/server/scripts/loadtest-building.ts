/**
 * BuildingRoom load test (issue #12): N simulated clients move at a fixed
 * rate for a fixed time; an observer client measures how long each move
 * takes to show up in its own state patch. Reports p50/p95/p99 latency and
 * the server's CPU use.
 *
 *   bun run --filter @regulus/server loadtest:building -- [--clients 20] [--hz 10] [--seconds 10] [--url http://host:port]
 *
 * Without `--url` a fresh office-server is spawned on a free port with a
 * temporary data dir (development auth), and its CPU is read from /proc.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import { BuildingStateSchema, ROOM_NAMES } from "@regulus/protocol";
import { DEV_USER_HEADER } from "../src/rooms/auth.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const CLIENTS = Number(arg("clients", "20"));
const HZ = Number(arg("hz", "10"));
const SECONDS = Number(arg("seconds", "10"));
const EXTERNAL_URL = arg("url", "");

interface SpawnedServer {
  url: string;
  pid: number;
  stop(): Promise<void>;
}

async function spawnServer(): Promise<SpawnedServer> {
  const dataDir = await mkdtemp(join(tmpdir(), "office-loadtest-"));
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../src/index.ts")], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      OFFICE_PORT: "0",
      OFFICE_HOST: "127.0.0.1",
      OFFICE_DATA_DIR: dataDir,
      OFFICE_WEB_DIST: join(dataDir, "no-dist"),
      OFFICE_LOG_LEVEL: "info",
    },
    stdout: "pipe",
    stderr: "inherit",
  });
  const url = await new Promise<string>((resolve, reject) => {
    let found: string | undefined;
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const pump = async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return reject(new Error("server exited before listening"));
        buffer += decoder.decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line) as { msg?: string; url?: string };
            if (entry.msg === "http listening" && entry.url) found = entry.url;
            if (entry.msg === "rooms listening" && found) return resolve(found);
          } catch {
            // not JSON
          }
        }
      }
    };
    pump().catch(reject);
  });
  return {
    url: url.replace(/\/$/, ""),
    pid: proc.pid,
    async stop() {
      proc.kill("SIGTERM");
      await proc.exited;
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** utime + stime of a Linux process in clock ticks (100/s), or undefined off Linux. */
function cpuTicks(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(fields[11]) + Number(fields[12]);
  } catch {
    return undefined;
  }
}

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0
    ? Number.NaN
    : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number);

async function main() {
  const spawned = EXTERNAL_URL ? undefined : await spawnServer();
  const url = EXTERNAL_URL || (spawned as SpawnedServer).url;
  console.log(`server: ${url}  clients: ${CLIENTS}  rate: ${HZ} Hz  duration: ${SECONDS} s`);

  const connect = (id: string): Promise<BuildingRoom> =>
    new Client(url, {
      headers: { [DEV_USER_HEADER]: JSON.stringify({ userId: id, displayName: id }) },
    }).joinOrCreate<BuildingState>(ROOM_NAMES.building, {}, BuildingStateSchema);

  const observer = await connect("observer");
  const movers: BuildingRoom[] = [];
  for (let i = 0; i < CLIENTS; i++) movers.push(await connect(`mover-${i}`));

  // seq is encoded in x (0.001 units per step) and the mover index in z.
  const sentAt = new Map<string, Map<number, number>>();
  const lastSeen = new Map<string, number>();
  const latencies: number[] = [];
  let patches = 0;
  let coalesced = 0;
  observer.onStateChange((state) => {
    patches++;
    const now = performance.now();
    for (const mover of movers) {
      const pos = state.humans.get(mover.sessionId)?.position;
      if (!pos) continue;
      const seq = Math.round(pos.x * 1000);
      const prev = lastSeen.get(mover.sessionId) ?? 0;
      if (seq <= prev) continue;
      const sent = sentAt.get(mover.sessionId);
      const at = sent?.get(seq);
      if (at !== undefined) latencies.push(now - at);
      for (let s = prev + 1; s < seq; s++) if (sent?.delete(s)) coalesced++;
      sent?.delete(seq);
      lastSeen.set(mover.sessionId, seq);
    }
  });

  await Bun.sleep(300);
  const cpuBefore = spawned ? cpuTicks(spawned.pid) : undefined;
  const started = performance.now();
  let sent = 0;
  const timers = movers.map((mover, i) => {
    let seq = 0;
    const map = new Map<number, number>();
    sentAt.set(mover.sessionId, map);
    return setInterval(() => {
      seq++;
      map.set(seq, performance.now());
      mover.send("move", { x: seq / 1000, z: i, heading: (seq % 60) / 10 });
      sent++;
    }, 1000 / HZ);
  });
  await Bun.sleep(SECONDS * 1000);
  for (const t of timers) clearInterval(t);
  await Bun.sleep(300);
  const wall = (performance.now() - started) / 1000;
  const cpuAfter = spawned ? cpuTicks(spawned.pid) : undefined;

  const sorted = [...latencies].sort((a, b) => a - b);
  const fmt = (n: number) => `${n.toFixed(1)} ms`;
  console.log(
    `moves sent: ${sent}  observed: ${latencies.length}  coalesced: ${coalesced}  patches: ${patches} (${(patches / wall).toFixed(1)}/s)`,
  );
  console.log(
    `latency p50: ${fmt(percentile(sorted, 0.5))}  p95: ${fmt(percentile(sorted, 0.95))}  p99: ${fmt(percentile(sorted, 0.99))}  max: ${fmt(sorted.at(-1) ?? Number.NaN)}`,
  );
  if (cpuBefore !== undefined && cpuAfter !== undefined) {
    const cpuSeconds = (cpuAfter - cpuBefore) / 100;
    console.log(
      `server CPU: ${cpuSeconds.toFixed(2)} s over ${wall.toFixed(1)} s wall = ${((cpuSeconds / wall) * 100).toFixed(1)}% of one core`,
    );
  } else {
    console.log("server CPU: n/a (external server or no /proc)");
  }

  await Promise.all([observer, ...movers].map((r) => Promise.race([r.leave(), Bun.sleep(500)])));
  await spawned?.stop();
}

await main();
