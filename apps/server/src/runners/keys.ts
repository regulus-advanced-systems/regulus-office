/**
 * How every backend implements `Runner.sendKeys` (#107).
 *
 * tmux refuses `send-keys` issued from outside while a read-only client
 * (`attach -r`, a terminal watcher) is on the session: it picks that client as
 * the command's target client and fails with "client is read-only", even with
 * an explicit `-t` pane and `-c` client (verified on tmux 3.7c). Buffers are
 * not affected, so input is loaded into a uniquely named buffer from stdin
 * (`load-buffer -b <name> -`, never argv: prompts may contain keys) and pasted
 * into the pane with `paste-buffer -d`, which also deletes the buffer.
 *
 * - Plain text (no control characters except tab, LF, CR) is pasted with `-p`,
 *   i.e. as a bracketed paste when the application asked for one, so a
 *   multi-line prompt is not submitted line by line.
 * - Anything else (Escape, Ctrl-C = "\x03", escape sequences) is pasted
 *   without `-p` and with `-S`, which writes the bytes as if typed. tmux 3.5+
 *   otherwise sanitizes control characters with vis(3) (Ctrl-C arrives as the
 *   two characters "^C"); older tmux has no `-S` ("unknown flag") and pastes
 *   raw anyway, so callers retry without it (see {@link isUnknownFlag}).
 * - Enter is a separate raw paste of "\r".
 *
 * `paste-buffer` turns LF into CR by default, like a terminal does on paste.
 */
import { randomBytes } from "node:crypto";

export type PasteMode = "text" | "raw";

/** What the Enter key sends. */
export const ENTER = "\r";

// C0 controls and DEL, except tab, LF and CR.
const RAW_BYTES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** `text` (bracketed paste) unless `keys` holds control characters meant as keystrokes. */
export function pasteMode(keys: string): PasteMode {
  return RAW_BYTES.test(keys) ? "raw" : "text";
}

/** A fresh buffer name per call, so concurrent sends never paste each other's input. */
export function pasteBufferName(): string {
  return `office-keys-${randomBytes(8).toString("hex")}`;
}

/**
 * `paste-buffer` arguments: paste `buffer` into `target` and delete it. `raw`
 * adds `-S` unless `legacy` (tmux older than 3.5, see {@link isUnknownFlag}).
 */
export function pasteBufferArgs(
  buffer: string,
  mode: PasteMode,
  target: string,
  legacy = false,
): string[] {
  const flags = mode === "text" ? ["-p"] : legacy ? [] : ["-S"];
  return ["paste-buffer", "-d", ...flags, "-b", buffer, "-t", target];
}

/** tmux's complaint about a flag it does not know (`-S` before tmux 3.5). */
export function isUnknownFlag(stderr: string): boolean {
  return /unknown flag|usage: paste-buffer/i.test(stderr);
}

/**
 * `sh -c PASTE_SCRIPT sh <socket> <buffer> <target> <bytes> <text|raw> <0|1>`
 * for backends that run tmux through a shell (docker): pastes the first
 * `<bytes>` bytes of stdin (read with `head -c`, since the exec's stdin is not
 * closed), then Enter when the last argument is 1. Input never touches argv.
 */
export const PASTE_SCRIPT = `sock=$1 buf=$2 target=$3 bytes=$4 mode=$5 enter=$6
paste() {
  tmux -S "$sock" load-buffer -b "$buf" - || return 1
  if [ "$1" = text ]; then flag=-p; else flag=-S; fi
  err=$(tmux -S "$sock" paste-buffer -d "$flag" -b "$buf" -t "$target" 2>&1) && return 0
  case $flag:$err in
    -S:*"unknown flag"* | -S:*"usage: paste-buffer"*)
      err=$(tmux -S "$sock" paste-buffer -d -b "$buf" -t "$target" 2>&1) && return 0 ;;
  esac
  tmux -S "$sock" delete-buffer -b "$buf" 2>/dev/null
  printf '%s\\n' "$err" >&2
  return 1
}
if [ "$bytes" -gt 0 ]; then head -c "$bytes" | paste "$mode" || exit 1; fi
if [ "$enter" = 1 ]; then printf '\\r' | paste raw || exit 1; fi
exit 0`;
