import { describe, expect, test } from "bun:test";
import { parsePortOutput } from "../runners/docker/procfs.ts";
import { listeningPorts, parseProcNetTcp } from "../runners/linux-user/proc.ts";
import {
  bannerTitle,
  htmlTitle,
  isLoopback,
  isWildcard,
  parsePrintedUrls,
  printedPorts,
  serviceTitle,
  stripAnsi,
  toListeners,
} from "./discovery.ts";

const SANDBOX = { host: "rg-sbx-a1", sandboxed: true };
const NO_SANDBOX = { host: "127.0.0.1", sandboxed: false };

describe("listeners", () => {
  test("one per port, widest address wins, loopback-only in a sandbox is local only", () => {
    const got = toListeners(
      [
        { port: 5173, address: "::1", pid: 7 },
        { port: 5173, address: "127.0.0.1", pid: 7 },
        { port: 3000, address: "127.0.0.1", pid: 8 },
        { port: 3000, address: "::", pid: 8 },
        { port: 8080, address: "10.231.0.5", pid: 9 },
      ],
      [
        { pid: 7, ppid: 1, command: "node" },
        { pid: 8, ppid: 1, command: "next-server" },
      ],
      SANDBOX,
    );
    expect(got).toEqual([
      { port: 3000, address: "::", pid: 8, command: "next-server", localOnly: false },
      { port: 5173, address: "::1", pid: 7, command: "node", localOnly: true },
      { port: 8080, address: "10.231.0.5", pid: 9, command: "", localOnly: false },
    ]);
  });

  test("without a sandbox the office shares the namespace, so loopback is reachable", () => {
    const [l] = toListeners([{ port: 5173, address: "127.0.0.1", pid: 1 }], [], NO_SANDBOX);
    expect(l?.localOnly).toBe(false);
  });

  test("address classes", () => {
    expect(isLoopback("127.0.0.53")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("::")).toBe(false);
    expect(isWildcard("0.0.0.0")).toBe(true);
    expect(isWildcard("::")).toBe(true);
  });

  test("docker /proc output: a localhost-only and a wide listener of the sandbox", () => {
    const tcp = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 111 1",
      "   1: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 222 1",
      "   2: 0100007F:0BB8 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1001        0 333 1",
      "--fds--",
      "41 socket:[111]",
      "42 socket:[222]",
    ].join("\n");
    const listeners = toListeners(parsePortOutput(tcp), [], SANDBOX);
    expect(listeners.map((l) => [l.port, l.localOnly])).toEqual([
      [3000, false],
      [5173, true],
    ]);
  });

  test("linux-user /proc/<pid>/net tables map through the helper's inodes", async () => {
    const table =
      "  sl  local_address rem_address   st\n   0: 00000000:1F90 00000000:0000 0A 0:0 0:0 0 1001 0 555 1\n";
    expect(parseProcNetTcp(table)).toEqual([{ inode: 555, address: "0.0.0.0", port: 8080 }]);
    // Not in any process table: nothing is attributed to the henchman.
    expect(await listeningPorts("/nonexistent", new Map())).toEqual([]);
  });
});

describe("terminal fast path", () => {
  const vite = [
    "\x1b[32m  VITE v5.4.2\x1b[39m  ready in 312 ms",
    "",
    "  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m",
    "  ➜  Network: use --host to expose",
  ].join("\n");

  test("URLs with ports, ANSI removed", () => {
    expect(stripAnsi("\x1b[1mhi\x1b[0m\x1b]0;title\x07")).toBe("hi");
    expect(parsePrintedUrls(vite)).toEqual([{ port: 5173, path: "/", line: 2 }]);
    expect(printedPorts("go to http://127.0.0.1:8000/docs and http://[::1]:9000")).toEqual(
      new Set([8000, 9000]),
    );
    expect(parsePrintedUrls("https://github.com/x")).toEqual([]);
  });

  test("the banner above the URL names the server", () => {
    expect(bannerTitle(vite, 5173)).toBe("Vite");
    expect(bannerTitle(vite, 3000)).toBeNull();
    const next = "  ▲ Next.js 15.0.0\n  - Local:        http://localhost:3000\n";
    expect(bannerTitle(next, 3000)).toBe("Next.js");
    const uvicorn = "INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)";
    expect(bannerTitle(uvicorn, 8000)).toBe("Uvicorn");
  });
});

describe("titles", () => {
  test("page titles, entities and whitespace", () => {
    expect(htmlTitle("<html><head><title>\n  Vite + React &amp; TS </title>")).toBe(
      "Vite + React & TS",
    );
    expect(htmlTitle("<title>&#x41;&#66;</title>")).toBe("AB");
    expect(htmlTitle("<p>no title</p>")).toBeNull();
    expect(htmlTitle("<title>   </title>")).toBeNull();
  });

  test("precedence: page (banner), banner, process, port", () => {
    expect(serviceTitle({ page: "Shop", banner: "Vite", port: 1 })).toBe("Shop (Vite)");
    expect(serviceTitle({ page: "Vite + React", banner: "Vite", port: 1 })).toBe("Vite + React");
    expect(serviceTitle({ banner: "Vite", command: "node", port: 1 })).toBe("Vite");
    expect(serviceTitle({ command: "python3", port: 1 })).toBe("python3");
    expect(serviceTitle({ port: 8080 })).toBe("Port 8080");
  });
});
