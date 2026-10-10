/**
 * Reading PM2, the pure part (#253): the fixed commands, what PM2 prints, and
 * which of it is a signal. The sample output is what PM2 6.0.14 printed for
 * these two commands on 2026-10-09 (a stand-in app crashing in a loop).
 */
import { describe, expect, test } from "bun:test";
import { cleanLine, scrubEvidence } from "./evidence.ts";
import {
  type AppMarks,
  appOfSignalKey,
  errorGroups,
  isErrorKey,
  lineSignature,
  linesSince,
  logLines,
  logMark,
  PM2_LIST,
  parseJlist,
  pm2Logs,
  readApp,
  sshArgv,
} from "./pm2.ts";

const TARGET = {
  host: "prod-1.example.com",
  port: 2222,
  username: "watchdog",
  keyPath: "/home/officeagents/.regulus-office/office-agents/a1/watchdog/h1.key",
  knownHostsPath: "/home/officeagents/.regulus-office/office-agents/a1/watchdog/h1.known_hosts",
  pinned: true,
};
const NOW = Date.UTC(2026, 9, 9, 9, 0, 0);
const NONE: AppMarks = { restarts: null, status: null, logMark: null };
const APP = { id: "app-1", name: "api" };

const STACK = [
  "2026-10-09T08:50:21.084Z TypeError: Cannot read properties of undefined (reading 'id')",
  "    at handler (/srv/app/src/routes/orders.js:42:17)",
  "    at Layer.handle (/srv/app/node_modules/express/lib/router/layer.js:95:5)",
  "upstream payments timed out after 3000 ms (request 8f2c1a7e-1111-4222-8333-444455556666)",
];
const AGAIN = STACK.map((line) => line.replace("08:50:21.084", "08:50:22.669"));

describe("the commands", () => {
  test("ssh runs one fixed remote command, with no agent, no forwarding and no config file", () => {
    const argv = sshArgv(TARGET, PM2_LIST);
    expect(argv.slice(0, 5)).toEqual(["ssh", "-F", "/dev/null", "-i", TARGET.keyPath]);
    expect(argv).toContain("BatchMode=yes");
    expect(argv).toContain("IdentitiesOnly=yes");
    expect(argv).toContain("ForwardAgent=no");
    expect(argv).toContain("StrictHostKeyChecking=yes");
    expect(argv).toContain(`UserKnownHostsFile=${TARGET.knownHostsPath}`);
    // The host stands after `--`, so it can never be read as an option.
    expect(argv.slice(-4)).toEqual(["--", "prod-1.example.com", "pm2", "jlist"]);
    expect(argv.slice(argv.indexOf("-p"), argv.indexOf("-p") + 4)).toEqual([
      "-p",
      "2222",
      "-l",
      "watchdog",
    ]);
  });

  test("a host without a pinned key is trusted on first contact and pinned from then on", () => {
    expect(sshArgv({ ...TARGET, pinned: false }, PM2_LIST)).toContain(
      "StrictHostKeyChecking=accept-new",
    );
  });

  test("the log command only reads", () => {
    expect(pm2Logs("api")).toEqual([
      "pm2",
      "logs",
      "api",
      "--err",
      "--nostream",
      "--raw",
      "--lines",
      "300",
    ]);
  });
});

describe("what PM2 prints", () => {
  test("jlist: the named fields, and nothing of a process's environment", () => {
    const stdout = JSON.stringify([
      {
        pid: 1,
        name: "api",
        pm2_env: {
          status: "online",
          restart_time: 7,
          unstable_restarts: 2,
          pm_uptime: 1_791_535_830_045,
          env: { DATABASE_URL: "postgres://app:hunter2@db/app" },
        },
      },
      { name: "web", pm2_env: { status: "stopped" } },
      { nameless: true },
    ]);
    const list = parseJlist(`[PM2] Spawning PM2 daemon\n${stdout}\n`);
    expect(list).toEqual([
      {
        name: "api",
        status: "online",
        restarts: 7,
        unstableRestarts: 2,
        startedAt: 1_791_535_830_045,
      },
      { name: "web", status: "stopped", restarts: 0, unstableRestarts: 0, startedAt: 0 },
    ]);
    expect(JSON.stringify(list)).not.toContain("hunter2");
    expect(parseJlist("pm2: command not found")).toBeNull();
    expect(parseJlist('{"not":"a list"}')).toBeNull();
  });

  test("logs: PM2's own coloured headers are dropped, the lines are kept", () => {
    const stdout =
      "\u001b[1m\u001b[90m[TAILING] Tailing last 300 lines for [api] process (change the value with --lines option)\u001b[39m\u001b[22m\n\u001b[90m/home/deploy/.pm2/logs/api-error.log last 300 lines:\u001b[39m\n\n";
    expect(logLines(`${stdout}\n${STACK.join("\n")}\n`)).toEqual(STACK);
  });

  test("a line is cleaned of escape sequences and capped", () => {
    expect(cleanLine("\u001b[31mboom\u001b[0m\u0007  ")).toBe("boom");
    expect(cleanLine("x".repeat(500)).length).toBe(300);
  });
});

describe("what is new since the last round", () => {
  test("only the lines after the place the last round read to", () => {
    const mark = logMark(STACK);
    expect(linesSince([...STACK, ...AGAIN], mark)).toEqual(AGAIN);
    expect(linesSince(STACK, mark)).toEqual([]);
    // The log rotated: the place is gone, so everything is new.
    expect(linesSince(AGAIN.slice(1), mark)).toEqual(AGAIN.slice(1));
    expect(linesSince(STACK, null)).toEqual(STACK);
    expect(logMark([])).toBeNull();
  });

  test("a crash loop that repeats the very same lines never hides a new line", () => {
    // No timestamps: every cycle is identical, so the place matches more than once.
    const cycle = STACK.slice(1);
    const read = [...cycle, ...cycle, ...cycle];
    const since = linesSince([...read, ...cycle, "something new"], logMark(read));
    expect(since.at(-1)).toBe("something new");
    // Lines may be read twice (same signal, same key), but none is skipped.
    expect(since.length).toBeGreaterThanOrEqual(cycle.length + 1);
  });

  test("the same error is one signature whatever its time, ids and numbers", () => {
    expect(lineSignature(STACK[0] ?? "")).toBe(lineSignature(AGAIN[0] ?? ""));
    expect(lineSignature(STACK[3] ?? "")).toBe(
      lineSignature(
        "upstream payments timed out after 2999 ms (request 00000000-aaaa-4bbb-8ccc-dddddddddddd)",
      ),
    );
    expect(lineSignature(STACK[0] ?? "")).not.toBe(lineSignature(STACK[3] ?? ""));
  });

  test("error lines are grouped, with the first one's stack as the sample", () => {
    const groups = errorGroups([...STACK, ...AGAIN]);
    expect(groups.map((g) => g.count)).toEqual([2, 2]);
    expect(groups[0]?.sample).toEqual(STACK.slice(0, 3));
    expect(groups[1]?.sample).toEqual([STACK[3] ?? ""]);
  });
});

describe("signals", () => {
  const online = { name: "api", status: "online", restarts: 7, unstableRestarts: 0, startedAt: 5 };

  test("the first reading is the baseline for restarts; error lines are signals at once", () => {
    const reading = readApp(APP, online, STACK, NONE, NOW);
    expect(reading.restartsSinceLastRound).toBeNull();
    expect(reading.signals.map((s) => s.kind)).toEqual(["error", "error"]);
    expect(reading.marks).toEqual({ restarts: 7, status: "online", logMark: logMark(STACK) });
    for (const signal of reading.signals) expect(appOfSignalKey(signal.key)).toBe("app-1");
  });

  test("restarts since the last round, and a crash loop by name", () => {
    const before: AppMarks = { restarts: 3, status: "online", logMark: logMark(STACK) };
    const reading = readApp(APP, online, STACK, before, NOW);
    expect(reading.restartsSinceLastRound).toBe(4);
    expect(reading.signals).toEqual([
      {
        key: "pm2:app-1:restarts:2026-10-09",
        kind: "restarts",
        summary: "api restarted 4 times since the last round (crash loop); 7 in all",
        lines: [],
      },
    ]);
    // One restart is told, and is no loop.
    const one = readApp(APP, online, null, { ...before, restarts: 6 }, NOW);
    expect(one.signals[0]?.summary).toBe("api restarted 1 time since the last round; 7 in all");
    // A counter that went down was reset: nothing to tell, and counting starts again.
    expect(readApp(APP, online, null, { ...before, restarts: 40 }, NOW).signals).toEqual([]);
  });

  test("the same error line has the same key on every round; a state has one per day", () => {
    const first = readApp(APP, online, STACK, NONE, NOW);
    const later = readApp(APP, online, AGAIN, NONE, NOW + 3 * 86_400_000);
    expect(later.signals.map((s) => s.key)).toEqual(first.signals.map((s) => s.key));
    expect(first.signals.every((s) => isErrorKey(s.key))).toBe(true);
    const down = { ...online, status: "errored" };
    expect(readApp(APP, down, null, NONE, NOW).signals[0]?.key).toBe("pm2:app-1:down:2026-10-09");
    expect(readApp(APP, down, null, NONE, NOW + 86_400_000).signals[0]?.key).toBe(
      "pm2:app-1:down:2026-10-10",
    );
    expect(isErrorKey("pm2:app-1:down:2026-10-09")).toBe(false);
  });

  test("an app that is not in the list is missing, and its marks are kept", () => {
    const before: AppMarks = { restarts: 3, status: "online", logMark: "abc" };
    const reading = readApp(APP, undefined, null, before, NOW);
    expect(reading.status).toBe("missing");
    expect(reading.signals.map((s) => s.key)).toEqual(["pm2:app-1:missing:2026-10-09"]);
    expect(reading.marks).toEqual({ restarts: 3, status: "missing", logMark: "abc" });
  });

  test("a key that the office did not make names no app", () => {
    for (const key of ["pm2:app-1", "pm2:app-1:err", "sentry:acme/WEB-1", "pm2:../x:err:abc", ""]) {
      expect(appOfSignalKey(key)).toBeNull();
    }
  });
});

describe("what a log line may show", () => {
  test("keys, passwords and tokens are replaced; paths and the error stay", () => {
    const line =
      "Error: connect ECONNREFUSED postgres://app:hunter2@db.internal:5432/app at /srv/app/src/db.js:10 with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abc123def456ghi789jkl012mno345 and STRIPE_SECRET_KEY=sk_live_abcdefgh12345678 key sk-ant-api03-FAKE-0123456789";
    const out = scrubEvidence(line);
    for (const secret of ["hunter2", "eyJhbGci", "sk_live_abcdefgh12345678", "sk-ant-api03"]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("/srv/app/src/db.js:10");
    expect(out).toContain("ECONNREFUSED");
    expect(out).toContain("STRIPE_SECRET_KEY=[redacted]");
    expect(scrubEvidence(out)).toBe(out);
  });

  test("a private key block goes whole; an ordinary line passes unchanged", () => {
    const block =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----";
    expect(scrubEvidence(`leaked ${block} here`)).toBe("leaked [redacted] here");
    expect(scrubEvidence(STACK[0] ?? "")).toBe(STACK[0] ?? "");
    expect(scrubEvidence("PORT=3000 NODE_ENV=production")).toBe("PORT=3000 NODE_ENV=production");
  });

  test("an error group's sample is scrubbed before anything else sees it", () => {
    const [group] = errorGroups(["fatal: login failed for password=hunter2 on db"]);
    expect(group?.sample.join("\n")).not.toContain("hunter2");
  });
});
