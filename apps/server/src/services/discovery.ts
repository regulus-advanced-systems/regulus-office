/**
 * Services discovery, the pure part (SPEC §9.4, research 01 §12, #39).
 *
 * The runner lists the LISTEN sockets of a henchman's sandbox with their pids
 * (`Runner.listPorts`: docker reads `/proc/net/tcp{,6}` inside the henchman's
 * container, linux-user the tables of its network namespace; both map socket
 * inodes to the sandbox's pids). Here those listeners become services: one
 * per port, classified as reachable by the proxy or "localhost only", and
 * titled from the henchman's terminal (the fast path: dev servers print their
 * URL and name), the page's `<title>`, or the process name.
 */
import type { PortInfo, ProcessInfo } from "../runners/types.ts";

/** Where the office reaches a henchman's ports. */
export interface ServiceTarget {
  /** Host name or address (a sandbox's container name or bridge address, or 127.0.0.1). */
  host: string;
  /** True when the henchman has its own network namespace (a sandbox); loopback there is its own. */
  sandboxed: boolean;
}

export interface Listener {
  port: number;
  /** The widest bind address seen for the port. */
  address: string;
  pid: number;
  /** Process name (`comm`), "" when unknown. */
  command: string;
  /** Bound to loopback inside a sandbox: the office cannot reach it. */
  localOnly: boolean;
}

export function isLoopback(address: string): boolean {
  return address.startsWith("127.") || address === "::1" || address.startsWith("::ffff:127.");
}

export function isWildcard(address: string): boolean {
  return address === "0.0.0.0" || address === "::" || address === "::ffff:0.0.0.0";
}

/** Rank of a bind address: wildcard first, then specific, loopback last. */
const rank = (address: string) => (isWildcard(address) ? 0 : isLoopback(address) ? 2 : 1);

/**
 * One listener per port (a server often binds both `0.0.0.0` and `::`, or
 * `127.0.0.1` and `::1`), keeping the widest address. With a sandbox, a
 * loopback-only port is unreachable from the office; without one (the local
 * backend, linux-user without sandboxes) the office shares the network
 * namespace and loopback is fine.
 */
export function toListeners(
  ports: readonly PortInfo[],
  processes: readonly ProcessInfo[],
  target: ServiceTarget | null,
): Listener[] {
  const command = new Map(processes.map((p) => [p.pid, p.command]));
  const byPort = new Map<number, PortInfo>();
  for (const p of ports) {
    if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65_535) continue;
    const seen = byPort.get(p.port);
    if (!seen || rank(p.address) < rank(seen.address)) byPort.set(p.port, p);
  }
  return [...byPort.values()]
    .sort((a, b) => a.port - b.port)
    .map((p) => ({
      port: p.port,
      address: p.address,
      pid: p.pid ?? 0,
      command: (p.pid !== undefined && command.get(p.pid)) || "",
      localOnly: target?.sandboxed === true && isLoopback(p.address),
    }));
}

/** A URL a dev server printed in the terminal. */
export interface PrintedUrl {
  port: number;
  /** Path after the port, "/" when none. */
  path: string;
  /** Index of the line it was printed on. */
  line: number;
}

const URL_RE =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[a-z0-9][a-z0-9.-]*):(\d{2,5})(\/[^\s'"<>`)]*)?/gi;

/** URLs with an explicit port in terminal text (ANSI escapes removed). */
export function parsePrintedUrls(text: string): PrintedUrl[] {
  const out: PrintedUrl[] = [];
  const lines = stripAnsi(text).split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(URL_RE)) {
      const port = Number(m[1]);
      if (port >= 1 && port <= 65_535) out.push({ port, path: m[2] || "/", line: i });
    }
  });
  return out;
}

export function stripAnsi(text: string): string {
  // CSI and OSC sequences, then any stray escape.
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b./g, "");
}

/** Dev-server banners, matched on the lines just above the printed URL. */
const BANNERS: readonly [RegExp, string][] = [
  [/\bVITE\b\s*v?\d/i, "Vite"],
  [/\bNext\.js\b/i, "Next.js"],
  [/\bastro\b\s*v?\d/i, "Astro"],
  [/\bNuxt\b/i, "Nuxt"],
  [/\bStorybook\b/i, "Storybook"],
  [/\bRemix\b/i, "Remix"],
  [/\bAngular\b/i, "Angular"],
  [/\bwebpack\b/i, "webpack"],
  [/\bParcel\b/i, "Parcel"],
  [/\bRsbuild\b/i, "Rsbuild"],
  [/\bDocusaurus\b/i, "Docusaurus"],
  [/\bJupyter\b/i, "Jupyter"],
  [/\bUvicorn\b/i, "Uvicorn"],
  [/\bDjango\b/i, "Django"],
  [/\bFlask\b|\bWerkzeug\b/i, "Flask"],
  [/\bPuma\b|\bRails\b/i, "Rails"],
  [/\bBun\b/, "Bun"],
];

/** Lines above a printed URL that may name its server. */
const BANNER_WINDOW = 8;

/** The dev server a henchman's terminal names for `port`, e.g. "Vite", or null. */
export function bannerTitle(text: string, port: number): string | null {
  const lines = stripAnsi(text).split("\n");
  const hits = parsePrintedUrls(text).filter((u) => u.port === port);
  for (const hit of hits.reverse()) {
    for (let i = hit.line; i >= Math.max(0, hit.line - BANNER_WINDOW); i--) {
      const line = lines[i] ?? "";
      for (const [re, name] of BANNERS) if (re.test(line)) return name;
    }
  }
  return null;
}

/** Ports printed in the terminal, most recent last (the fast path's hint). */
export function printedPorts(text: string): Set<number> {
  return new Set(parsePrintedUrls(text).map((u) => u.port));
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The `<title>` of an HTML page, whitespace collapsed, or null. */
export function htmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return null;
  const text = m[1]
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isInteger(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENTITIES[code.toLowerCase()] ?? all;
    })
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 120) : null;
}

export const MAX_TITLE = 200;

/**
 * The title shown in the Running apps panel: "<page title> (Vite)" when both
 * are known, else whichever is, else the process name, else "Port <n>".
 */
export function serviceTitle(parts: {
  banner?: string | null;
  page?: string | null;
  command?: string;
  port: number;
}): string {
  const { banner, page, command, port } = parts;
  let title: string;
  if (page && banner && !page.toLowerCase().includes(banner.toLowerCase()))
    title = `${page} (${banner})`;
  else title = page || banner || command || `Port ${port}`;
  return title.slice(0, MAX_TITLE);
}
