/**
 * Tiny readers for untrusted JSON (hook bodies, statusline input, transcript
 * lines). Everything Claude Code sends is treated as `unknown` and read field
 * by field; nothing is trusted to have the documented shape.
 */

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(obj: Json | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === "string" ? v : undefined;
}

export function num(obj: Json | undefined, key: string): number | undefined {
  const v = obj?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function bool(obj: Json | undefined, key: string): boolean | undefined {
  const v = obj?.[key];
  return typeof v === "boolean" ? v : undefined;
}

export function obj(parent: Json | undefined, key: string): Json | undefined {
  const v = parent?.[key];
  return isObject(v) ? v : undefined;
}

export function arr(parent: Json | undefined, key: string): unknown[] | undefined {
  const v = parent?.[key];
  return Array.isArray(v) ? v : undefined;
}

/** Cut to `max` characters (protocol field limits), collapsing whitespace runs. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat;
}

/** Non-negative integer or 0; token counts from untrusted input. */
export function count(value: number | undefined): number {
  return value !== undefined && value > 0 ? Math.floor(value) : 0;
}
