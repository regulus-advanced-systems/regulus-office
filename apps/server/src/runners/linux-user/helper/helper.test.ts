/**
 * Argument validation of the real helper script. It validates everything
 * before it checks for root, so running it unprivileged shows which inputs
 * the grammar accepts (exit 1 "must run as root") and which it rejects
 * (exit 2) without touching the system.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const HELPER = join(import.meta.dir, "office-runner-helper");
const isRoot = process.getuid?.() === 0;

async function helper(args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["bash", HELPER, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

const P = "/srv/office/projects";
const W = "/srv/office/worktrees";
const accepted: string[][] = [
  ["provision", "u1"],
  ["provision", "0123456789abcdef0123456"],
  ["deprovision", "u1"],
  ["mount-project", "u1", `${W}/floor1/u1`],
  ["mount-project", "u1", `${W}/floor1/u1/a1`],
  ["mount-project", "u1", `${W}/floor1/u1/_clones/repo-1`],
  ["reclaim", P],
  ["reclaim", `${P}/floor1`],
  ["reclaim", `${P}/floor1/repo-1`],
  ["reclaim", `${W}/floor1/0f8c2d9e-agent`],
  ["remove-floor", "floor1"],
  ["remove-floor", "apollo-moon-2"],
  ["remove-floor", "a"],
  ["exec", "u1", "a1", "/srv/x y", "--", "sh", "-c", "echo $HOME; rm -rf /"],
  ["spawn-piped", "u1", "a_1-B", "/", "--", "codex", "app-server"],
  ["kill", "u1", "a1"],
  ["sockets", "u1", "a1"],
  ["capture", "u1", "agent-a1", "200"],
  ["pane-title", "u1", "agent-a1"],
  ["send-keys", "u1", "agent-a1", "1", "text"],
  ["send-keys", "u1", "agent-a1", "0", "raw"],
  ["has-session", "u1", "agent-a1"],
  ["list-sessions", "u1"],
  ["attach", "u1", "agent-a1", "ro"],
  ["write-file", "u1", "/home/office-u-u1/.claude/settings.json", "600"],
  ["write-file", "u1", "/home/office-u-u1/bin/hook", "0755"],
  ["read-file", "u1", "/home/office-u-u1/.codex/sessions/x.jsonl"],
  ["list-dir", "u1", "/home/office-u-u1"],
];
const rejected: string[][] = [
  [],
  ["frobnicate", "u1"],
  ["provision"],
  ["provision", "u1", "extra"],
  ["provision", "U1"],
  ["provision", "u1;id"],
  ["provision", "$(id)"],
  ["provision", "../root"],
  ["provision", "0123456789abcdef01234567"],
  ["provision", ""],
  ["mount-project", "u1", "/etc"],
  ["mount-project", "u1", P],
  ["mount-project", "u1", `${P}/../../etc`],
  ["mount-project", "u1", `${P}/f/./r`],
  ["mount-project", "u1", `${P}/f/.git`],
  ["mount-project", "u1", `${P}//f`],
  ["mount-project", "u1", `${P}/f/`],
  ["mount-project", "u1", `${P}/f r`],
  ["mount-project", "u1", `${P}evil/f`],
  // #114: only the human's own area, never a mirror, a floor dir or another human's area.
  ["mount-project", "u1", `${P}/floor1/repo-1`],
  ["mount-project", "u1", `${P}/floor1/u1`],
  ["mount-project", "u1", W],
  ["mount-project", "u1", `${W}/floor1`],
  ["mount-project", "u1", `${W}/floor1/u2`],
  ["mount-project", "u1", `${W}/floor1/u2/a1`],
  ["mount-project", "u1", `${W}/floor1/u10/a1`],
  ["mount-project", "u1", `${W}/floor1/a1/u1`],
  ["mount-project", "u1", `${W}/floor1/.u1`],
  ["reclaim"],
  ["reclaim", "/etc"],
  ["reclaim", W],
  ["reclaim", `${W}/floor1`],
  ["reclaim", `${W}/floor1/u1/a1`],
  ["reclaim", `${W}/floor1/u1`],
  ["reclaim", `${P}/../etc`],
  ["reclaim", `${P}/f/.git`],
  ["reclaim", `${P}evil`],
  ["reclaim", `${P}/f`, "extra"],
  // #150: a floor slug only, never a path, dot segment or glob.
  ["remove-floor"],
  ["remove-floor", ""],
  ["remove-floor", "."],
  ["remove-floor", ".."],
  ["remove-floor", "floor1/u1"],
  ["remove-floor", "../etc"],
  ["remove-floor", "/etc"],
  ["remove-floor", `${W}/floor1`],
  ["remove-floor", "Floor1"],
  ["remove-floor", "-floor"],
  ["remove-floor", "floor-"],
  ["remove-floor", "floor.1"],
  ["remove-floor", "*"],
  ["remove-floor", "floor1", "extra"],
  ["remove-floor", "a".repeat(65)],
  ["exec", "u1", "a1", "/w", "sh"],
  ["exec", "u1", "a1", "/w", "--"],
  ["exec", "u1", "a1", "/w", "--", ""],
  ["exec", "u1", "a.1", "/w", "--", "sh"],
  ["exec", "u1", "a1", "relative", "--", "sh"],
  ["exec", "u1", "a1", "/w\nx", "--", "sh"],
  ["kill", "u1", "a1:0"],
  ["kill", "u1", "*"],
  ["sockets", "u1", ""],
  ["capture", "u1", "agent-a1", "-5"],
  ["capture", "u1", "=agent-a1", "5"],
  ["capture", "u1", "other", "5"],
  ["pane-title", "u1", "agent-a1;id"],
  ["send-keys", "u1", "agent-a1", "yes", "text"],
  ["send-keys", "u1", "agent-a1", "1"],
  ["send-keys", "u1", "agent-a1", "1", "bracketed"],
  ["send-keys", "u1", "agent-a1", "1", "text", "extra"],
  ["attach", "u1", "agent-a1", "rwx"],
  ["write-file", "u1", "/x", "4755"],
  ["write-file", "u1", "/x", "u+s"],
  ["write-file", "u1", "x", "600"],
  ["read-file", "u1", "/a\tb"],
  ["list-dir", "u1", ""],
];

describe.skipIf(isRoot || process.platform !== "linux")("office-runner-helper grammar", () => {
  test.each(accepted)("accepts %p", async (...args) => {
    const res = await helper(args);
    expect(res.stderr).toContain("must run as root");
    expect(res.code).toBe(1);
  });

  test.each(rejected)("rejects %p", async (...args) => {
    const res = await helper(args);
    expect(res.code).toBe(2);
    expect(res.stderr).not.toContain("must run as root");
  });
});

describe("sudoers rules", () => {
  test("the doc lists exactly the sudoers file's rules, one per helper verb", async () => {
    const sudoers = await readFile(join(import.meta.dir, "office-runner.sudoers"), "utf8");
    const doc = await readFile(
      join(import.meta.dir, "../../../../../../docs/deploy/linux-user-runner.md"),
      "utf8",
    );
    const rules = sudoers.split("\n").filter((l) => l && !l.startsWith("#"));
    for (const rule of rules) expect(doc).toContain(rule);
    const script = await readFile(HELPER, "utf8");
    const verbs = rules
      .map((r) => r.match(/office-runner-helper ([a-z-]+) \*$/)?.[1])
      .filter((v): v is string => v !== undefined);
    expect(verbs.length).toBe(18);
    for (const verb of verbs) expect(script).toContain(`  ${verb}`);
  });
});
