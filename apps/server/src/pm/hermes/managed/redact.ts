/**
 * What a managed Hermes printed before it ended, made safe to show (#57):
 * every secret it was handed is cut out by value, and whatever else looks
 * like a key or a token is cut out by shape.
 */
import type { HermesExit } from "./host.ts";

const HIDDEN = "[hidden]";
const SHAPES = [
  /\b(?:sk|pk|rk|roa|ghp|gho|ghs|xox[a-z])[-_][A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+\S+/gi,
  // Long runs of key-like characters: hex, base64, JWT parts.
  /[A-Za-z0-9+/_-]{32,}={0,2}/g,
];
const REASON_MAX = 200;
const COLOURS = /\u001b\[[0-9;]*[A-Za-z]/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  // Longest first, so a key that contains another is cut whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 6) out = out.split(secret).join(HIDDEN);
  }
  for (const shape of SHAPES) out = out.replace(shape, HIDDEN);
  return out;
}

/**
 * One short phrase for how a gateway ended, e.g. `exit code 1: config.yaml: bad provider`.
 * A gateway that was killed (by a signal: out of memory, or from outside) did
 * not get to say why, so what it happened to print last is left out.
 */
export function describeExit(exit: HermesExit, secrets: readonly string[]): string {
  if (exit.code === null || exit.code > 128) return "it was killed";
  const how = `exit code ${exit.code}`;
  const last = redact(exit.tail, secrets)
    .split("\n")
    // Terminal colours and control characters say nothing.
    .map((line) => line.replace(COLOURS, "").replace(CONTROL, " ").trim())
    .filter(Boolean)
    .at(-1);
  if (!last) return how;
  return `${how}: ${last.length > REASON_MAX ? `${last.slice(0, REASON_MAX)}…` : last}`;
}
