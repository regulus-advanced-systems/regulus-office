/** Shared fixtures for secrets tests. Keys are generated per run; nothing here is a real secret. */

import { randomBytes } from "node:crypto";
import { parseEnvelope, type SecretEnvelope, serializeEnvelope } from "./envelope.ts";
import type { Keyring } from "./master-key.ts";

export const CONTEXT = { userId: "user_01HTESTUSER", secretName: "deepseek:api_key" } as const;
export const PLAINTEXT = "sk-test-FAKE-plaintext-0123456789abcdefghijklmnop";

export function freshKey(): Buffer {
  return randomBytes(32);
}

export function keyringOf(entries: Record<number, Buffer>): Keyring {
  return Object.freeze({ ...entries });
}

/** Changes the first character of a base64url field, guaranteeing a byte-level change. */
export function flipFirstChar(text: string): string {
  const replacement = text.startsWith("A") ? "B" : "A";
  return replacement + text.slice(1);
}

export function withField<K extends keyof SecretEnvelope>(
  stored: string,
  field: K,
  mutate: (value: SecretEnvelope[K]) => SecretEnvelope[K],
): string {
  const envelope = parseEnvelope(stored);
  return serializeEnvelope({ ...envelope, [field]: mutate(envelope[field]) });
}

/** Every string that must never appear in an error: plaintext plus all key encodings. */
export function forbiddenStrings(keys: readonly Buffer[]): string[] {
  const out = [PLAINTEXT];
  for (const key of keys) {
    out.push(key.toString("hex"), key.toString("base64"), key.toString("base64url"));
  }
  return out;
}

export function assertNoLeak(error: unknown, forbidden: readonly string[]): void {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  for (const needle of forbidden) {
    if (text.includes(needle)) throw new Error("error text leaked secret material");
  }
}
