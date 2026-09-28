/** Shell snippets for execs in runner containers (secrets go on stdin, never argv). */

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
