/**
 * Stand-in for `codex app-server` over real stdio, for integration tests:
 *
 *   bun fake-app-server-main.ts <trace.jsonl> [ignored codex args...]
 *
 * Plays the trace (trace.ts) against whatever the client writes on stdin.
 * Exits with 3 on the first mismatch (after writing it to stderr), with the
 * trace's exit code on an exit step, and with 0 on SIGTERM.
 */
import { parseTrace, TraceReplayer } from "./trace.ts";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: fake-app-server-main.ts <trace.jsonl>\n");
  process.exit(2);
}
const replayer = new TraceReplayer(parseTrace(await Bun.file(path).text()));
process.on("SIGTERM", () => process.exit(0));

function play(emissions: ReturnType<TraceReplayer["start"]>): void {
  if (replayer.errors.length > 0) {
    process.stderr.write(`${replayer.errors.join("\n")}\n`);
    process.exit(3);
  }
  for (const e of emissions) {
    if ("exit" in e) process.exit(e.exit);
    process.stdout.write(`${e.line}\n`);
  }
}

play(replayer.start());
let buffer = "";
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.trim()) play(replayer.receive(line));
  }
}
