/**
 * Periodic Claude Code transcript scan (ccusage-style, research 04 §4) that
 * runs inside the human's own runner: a short POSIX `sh` script, started as
 * the runner identity through `RunnerOps.spawnPiped`, finds the transcripts
 * changed in the last few days under `~/.claude/projects` and prints only the
 * assistant lines that carry `usage`, from where the previous scan stopped.
 * The office never reads another human's HOME itself (SPEC §8), and nothing
 * else in `~/.claude` is opened.
 *
 * Incremental: per file, the scan remembers the byte offset it has read up
 * to (kept by the adapter per human, handed to the script in a 0600 file in
 * the runner). A file whose last line is still being written is left for the
 * next scan. After an office restart the offsets are gone and the recent
 * files are read again; the office dedupes by message id (`dedupeKey`).
 */
import type { UsageSample } from "@regulus/protocol";
import { SecretEnv } from "../secret.ts";
import { tmuxSessionName } from "../session.ts";
import type { RunnerContext, SpawnPlan } from "../types.ts";
import { parseTranscriptUsage, transcriptRoot } from "./transcript.ts";

/** Transcripts untouched for longer than this are skipped (weekly window + a day). */
export const TRANSCRIPT_MAX_AGE_DAYS = 8;
/** A scan that takes longer than this is stopped. */
export const TRANSCRIPT_SCAN_TIMEOUT_MS = 60_000;

/** Marks a file header line in the script's output: `\x1e<size>\t<path>`. */
const HEADER = "\x1e";

/**
 * `sh -c` body. Arguments: transcript root, offsets file (`<offset>\t<path>`
 * lines), max age in days. Output per changed file: a header line with the
 * size read up to, then that file's new usage lines.
 */
export const TRANSCRIPT_SCAN_SCRIPT = `
root=$1; cursors=$2; days=$3
[ -d "$root" ] || exit 0
[ -f "$cursors" ] || cursors=/dev/null
find "$root" -mindepth 2 -maxdepth 4 -type f -name '*.jsonl' -mtime -"$days" 2>/dev/null |
while IFS= read -r f; do
  size=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  case "$size" in ''|*[!0-9]*) continue ;; esac
  off=$(awk -F '\\t' -v p="$f" '$2 == p { print $1; exit }' "$cursors" 2>/dev/null)
  case "$off" in ''|*[!0-9]*) off=0 ;; esac
  [ "$size" -lt "$off" ] && off=0
  [ "$size" -eq "$off" ] && continue
  last=$(tail -c +"$size" "$f" 2>/dev/null | head -c 1 | od -An -c | tr -d ' ')
  [ "$last" = '\\n' ] || continue
  printf '\\036%s\\t%s\\n' "$size" "$f"
  tail -c +"$((off + 1))" "$f" | head -c "$((size - off))" | grep -F '"assistant"' | grep -F '"usage"'
done
exit 0
`;

export interface TranscriptScanOptions {
  since?: number;
  signal?: AbortSignal;
  maxAgeDays?: number;
  timeoutMs?: number;
}

/** The side process's plan: not an agent, no secrets, runs in the human's runner. */
export function transcriptScanPlan(
  ctx: RunnerContext,
  cursors: ReadonlyMap<string, number>,
): SpawnPlan {
  const agentId = `claude-usage-${ctx.userId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  const home = ctx.home.replace(/\/+$/, "");
  const cursorFile = `${home}/.regulus-office/usage/claude-transcripts.tsv`;
  const lines = [...cursors].map(([path, offset]) => `${offset}\t${path}`);
  return {
    agentId,
    provider: "claude-code",
    argv: [
      "sh",
      "-c",
      TRANSCRIPT_SCAN_SCRIPT,
      "sh",
      transcriptRoot(home),
      cursorFile,
      String(TRANSCRIPT_MAX_AGE_DAYS),
    ],
    env: SecretEnv.of({ HOME: home, LC_ALL: "C" }),
    cwd: home,
    tmuxSession: tmuxSessionName(agentId),
    files: [
      { path: cursorFile, contents: lines.length ? `${lines.join("\n")}\n` : "", mode: 0o600 },
    ],
  };
}

function sessionFromPath(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : undefined;
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    rest += decoder.decode(chunk, { stream: true });
    let nl = rest.indexOf("\n");
    while (nl >= 0) {
      yield rest.slice(0, nl);
      rest = rest.slice(nl + 1);
      nl = rest.indexOf("\n");
    }
  }
  rest += decoder.decode();
  if (rest) yield rest;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    for await (const _ of stream) {
      // discarded: stderr may name paths, never needed
    }
  } catch {
    // process gone
  }
}

/** Keeps each human's read offsets between scans (in memory; lost on restart, see above). */
export class TranscriptScanner {
  readonly #cursors = new Map<string, Map<string, number>>();

  async *scan(ctx: RunnerContext, opts: TranscriptScanOptions = {}): AsyncIterable<UsageSample> {
    if (opts.signal?.aborted) return;
    const known = this.#cursors.get(ctx.userId) ?? new Map<string, number>();
    const plan = transcriptScanPlan(ctx, known);
    if (opts.maxAgeDays !== undefined) {
      (plan.argv as string[])[6] = String(Math.max(1, Math.floor(opts.maxAgeDays)));
    }
    const proc = await ctx.runner.spawnPiped(plan);
    let exited = false;
    void proc.exited.then(
      () => (exited = true),
      () => (exited = true),
    );
    const stop = () => {
      if (!exited) proc.kill("SIGKILL");
    };
    const timer = setTimeout(stop, opts.timeoutMs ?? TRANSCRIPT_SCAN_TIMEOUT_MS);
    opts.signal?.addEventListener("abort", stop, { once: true });
    void drain(proc.stderr);
    const next = new Map(known);
    const seen = new Set<string>();
    let file: string | undefined;
    try {
      for await (const line of lines(proc.stdout)) {
        if (line.startsWith(HEADER)) {
          const tab = line.indexOf("\t");
          const size = Number(line.slice(1, tab));
          file = line.slice(tab + 1);
          if (tab > 1 && Number.isSafeInteger(size) && file.startsWith("/")) next.set(file, size);
          continue;
        }
        yield* parseTranscriptUsage(line, seen, opts.since, file && sessionFromPath(file));
      }
      const code = await proc.exited;
      // Only a complete scan moves the offsets on; otherwise read it again next time.
      if (code === 0 && !opts.signal?.aborted) {
        for (const path of next.keys())
          if (!path.startsWith(transcriptRoot(ctx.home))) next.delete(path);
        this.#cursors.set(ctx.userId, next);
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", stop);
      if (!exited) proc.kill("SIGTERM");
    }
  }

  forget(userId: string): void {
    this.#cursors.delete(userId);
  }
}
