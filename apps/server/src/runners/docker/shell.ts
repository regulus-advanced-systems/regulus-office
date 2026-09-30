/** Shell snippets for execs in runner containers (secrets go on stdin, never argv). */
import { posix } from "node:path";
import type { PlannedFile } from "@regulus/agent-adapters";
import type { EngineClient } from "./engine.ts";

/** POSIX single-quote a word for `sh`. */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** `export NAME='value'` lines for an env file the session sources. */
export function envFileContents(env: Readonly<Record<string, string>>): string {
  const lines = Object.entries(env).map(([k, v]) => `export ${k}=${shellQuote(v)}`);
  return `${lines.join("\n")}\n`;
}

/** `sh -c WRITE_SCRIPT sh <path> <bytes> <octal-mode>`, contents on stdin. */
export const WRITE_SCRIPT = [
  "umask 077",
  'mkdir -p -m 700 -- "$(dirname -- "$1")" || exit 1',
  't="$1.office-tmp-$$"',
  'if head -c "$2" > "$t" && chmod "$3" "$t" && mv -f -- "$t" "$1"; then exit 0; fi',
  'rm -f -- "$t"; exit 1',
].join("\n");

/** Write a file as the runner uid: contents on exec stdin (never argv), then a rename. */
export async function writeFileExec(
  engine: EngineClient,
  containerId: string,
  file: PlannedFile,
): Promise<void> {
  const path = posix.normalize(file.path);
  if (!posix.isAbsolute(path)) throw new Error(`runner file path must be absolute: ${path}`);
  const contents = typeof file.contents === "string" ? file.contents : file.contents.reveal();
  const bytes = new TextEncoder().encode(contents);
  const mode = ((file.mode ?? 0o600) & 0o7777).toString(8);
  const res = await engine.execWithInput(
    containerId,
    { cmd: ["sh", "-c", WRITE_SCRIPT, "sh", path, `${bytes.byteLength}`, mode] },
    bytes,
  );
  if (res.code !== 0) throw new Error(`write ${path} failed: ${res.stderr.trim()}`);
}
