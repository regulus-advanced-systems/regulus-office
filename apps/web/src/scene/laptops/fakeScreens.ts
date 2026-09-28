/**
 * `?fakeScreens[=n]` perf probe (like `?stats`): fills the first n desk
 * seats (all by default) with pretend robots whose screens scroll fake
 * build output, so laptop textures can be measured without agents or a
 * server. Purely client-side; nothing is sent anywhere.
 */
export function fakeScreensCount(search: string): number | null {
  const params = new URLSearchParams(search);
  if (!params.has("fakeScreens")) return null;
  const n = Number.parseInt(params.get("fakeScreens") ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

export const fakeAgentId = (seatId: string) => `fake-${seatId}`;

const WORDS = ["compiling", "linking", "testing", "reading", "editing", "fetching", "writing"];
const FILES = ["src/app.ts", "src/net/ws.ts", "README.md", "test/e2e.ts", "lib/util.ts"];

/** Deterministic pseudo terminal output for fake robot `index` at `tick`. */
export function fakeScreenText(index: number, tick: number, rows = 45): string {
  const lines: string[] = [];
  const start = Math.max(0, tick - rows + 3);
  for (let i = start; i < tick; i++) {
    const w = WORDS[(i * 7 + index) % WORDS.length];
    const f = FILES[(i * 3 + index * 5) % FILES.length];
    lines.push(`  ${w} ${f} ${"·".repeat((i * 13 + index) % 40)} ${(i * 37) % 100}%`);
  }
  lines.push("");
  lines.push(`$ robot-${index} working (step ${tick})`);
  return lines.join("\n");
}
