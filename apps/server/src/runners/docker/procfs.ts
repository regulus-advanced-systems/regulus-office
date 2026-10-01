/**
 * Process and port discovery inside a runner container, from `/proc` alone
 * (the runner image has no procps or iproute2). The shell snippets run as the
 * runner user via exec, so they see the container's pid and net namespaces
 * (research 01 §12); the parsers turn their output into `ProcessInfo` /
 * `PortInfo`.
 */
import type { PortInfo, ProcessInfo } from "../types.ts";

/**
 * `sh -c SCRIPT sh <tmux-socket> <pane-target>`: prints the pane pid, then one
 * `/proc/<pid>/stat` line per process.
 */
export const PROCESS_SCRIPT = [
  `pane=$(tmux -S "$1" display-message -p -t "$2" '#{pane_pid}' 2>/dev/null) || exit 0`,
  `echo "$pane"`,
  `for d in /proc/[0-9]*; do s=$(cat "$d/stat" 2>/dev/null) && printf '%s\\n' "$s"; done`,
].join("\n");

/**
 * `sh -c SCRIPT sh <pid>...`: prints `/proc/net/tcp{,6}`, a marker, then
 * `<pid> socket:[<inode>]` for every socket fd of the given pids.
 */
export const PORT_SCRIPT = [
  "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null",
  "echo '--fds--'",
  'for p in "$@"; do for f in /proc/$p/fd/*; do',
  '  l=$(readlink "$f" 2>/dev/null) && case $l in socket:*) echo "$p $l";; esac',
  "done; done",
].join("\n");

interface StatLine extends ProcessInfo {
  session: number;
}

/** Parse one `/proc/<pid>/stat` line: `pid (comm) state ppid pgrp session ...`. */
export function parseStat(line: string): StatLine | null {
  const open = line.indexOf(" (");
  const close = line.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(line.slice(0, open));
  const rest = line
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number(rest[1]);
  const session = Number(rest[3]);
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return null;
  return { pid, ppid, session, command: line.slice(open + 2, close) };
}

/**
 * Processes of the pane: the pane pid's descendants plus anything still in its
 * session (the pane is a session leader, so children reparented to init after
 * their parent exits are still found unless they called setsid).
 */
export function parseProcessOutput(output: string): ProcessInfo[] {
  const [first, ...lines] = output.split("\n");
  const root = Number(first?.trim());
  if (!Number.isInteger(root) || root <= 0) return [];
  const all = lines.map(parseStat).filter((p): p is StatLine => p !== null);
  const tree = new Set([root]);
  for (const p of all) if (p.session === root) tree.add(p.pid);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all) {
      if (!tree.has(p.pid) && tree.has(p.ppid)) {
        tree.add(p.pid);
        grew = true;
      }
    }
  }
  return all
    .filter((p) => tree.has(p.pid))
    .map(({ pid, ppid, command }) => ({ pid, ppid, command }));
}

/**
 * `sh -c SCRIPT`: in a henchman's own sandbox (#169) every process is the henchman's,
 * detached dev servers included. Prints the script's own pid, then one
 * `/proc/<pid>/stat` line per process.
 */
export const SANDBOX_PROCESS_SCRIPT = [
  'echo "$$"',
  `for d in /proc/[0-9]*; do s=$(cat "$d/stat" 2>/dev/null) && printf '%s\\n' "$s"; done`,
].join("\n");

/**
 * Processes of a sandbox, without its plumbing: the init (pid 1), the container's
 * `sleep`, the tmux server, and the listing exec itself with its children.
 */
export function parseSandboxProcesses(output: string): ProcessInfo[] {
  const [first, ...lines] = output.split("\n");
  const self = Number(first?.trim());
  const all = lines.map(parseStat).filter((p): p is StatLine => p !== null);
  const plumbing = (p: StatLine) =>
    p.pid === 1 ||
    p.pid === self ||
    p.ppid === self ||
    (p.ppid === 1 && p.command === "sleep") ||
    p.command.startsWith("tmux");
  return all.filter((p) => !plumbing(p)).map(({ pid, ppid, command }) => ({ pid, ppid, command }));
}

/** Listening TCP sockets (`st == 0A`) owned by the given pids. */
export function parsePortOutput(output: string): PortInfo[] {
  const [table = "", fds = ""] = output.split("--fds--");
  const owner = new Map<string, number>();
  for (const line of fds.split("\n")) {
    const m = line.trim().match(/^(\d+) socket:\[(\d+)\]$/);
    if (m?.[1] && m[2]) owner.set(m[2], Number(m[1]));
  }
  const ports: PortInfo[] = [];
  const seen = new Set<string>();
  for (const line of table.split("\n")) {
    const cols = line.trim().split(/\s+/);
    const [, local, , state, , , , , , inode] = cols;
    if (state !== "0A" || !local || !inode) continue;
    const pid = owner.get(inode);
    if (pid === undefined) continue;
    const [hexAddr = "", hexPort = ""] = local.split(":");
    const port = Number.parseInt(hexPort, 16);
    const address = decodeAddress(hexAddr);
    const key = `${address}:${port}`;
    if (Number.isNaN(port) || seen.has(key)) continue;
    seen.add(key);
    ports.push({ port, address, pid });
  }
  return ports.sort((a, b) => a.port - b.port);
}

/** `/proc/net/tcp` addresses are 32-bit words in host (little-endian) order. */
export function decodeAddress(hex: string): string {
  const words = hex.match(/.{8}/g) ?? [];
  const bytes = words.flatMap((w) => (w.match(/../g) ?? []).reverse().map((b) => parseInt(b, 16)));
  if (bytes.length === 4) return bytes.join(".");
  const groups: string[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  }
  const v6 = groups.join(":");
  if (v6 === "0:0:0:0:0:0:0:0") return "::";
  if (v6.startsWith("0:0:0:0:0:ffff:")) {
    return `::ffff:${bytes.slice(12).join(".")}`;
  }
  return v6.replace(/\b(?:0:){2,}/, ":").replace(/^:(?=[^:])/, "::");
}
