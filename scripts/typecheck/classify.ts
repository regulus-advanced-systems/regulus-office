/**
 * Classifies one `tsc --noEmit` run so the typecheck gate can retry a crash of
 * the native TypeScript 7 compiler (tsgo) without ever hiding a real type error.
 * Background: issue #83.
 */

export type RunOutcome = "ok" | "type_error" | "compiler_crash";

/** Go runtime crash markers printed by tsgo when it faults. */
const CRASH_MARKERS = [
  /^fatal error: /m,
  /^unexpected fault address /m,
  /^\[signal SIG(SEGV|BUS)/m,
  /^goroutine \d+ .*\[running\]:/m,
];

/** A diagnostic line such as `src/a.ts(3,5): error TS2322: ...`. */
const DIAGNOSTIC = /^(.*?)\(\d+,\d+\): error TS\d+:/gm;

/**
 * - exit 0 → ok.
 * - Go runtime crash markers and no diagnostics → compiler_crash.
 * - Diagnostics that all point into node_modules (e.g. a spurious TS1005 in
 *   lib.dom.d.ts; skipLibCheck is on, so these cannot come from our code) →
 *   compiler_crash.
 * - Anything else that failed → type_error, never retried.
 */
export function classifyRun(exitCode: number, output: string): RunOutcome {
  if (exitCode === 0) return "ok";
  const files = [...output.matchAll(DIAGNOSTIC)].map((m) => m[1] ?? "");
  if (files.length === 0) {
    return CRASH_MARKERS.some((re) => re.test(output)) ? "compiler_crash" : "type_error";
  }
  return files.every((f) => f.includes("node_modules/")) ? "compiler_crash" : "type_error";
}
