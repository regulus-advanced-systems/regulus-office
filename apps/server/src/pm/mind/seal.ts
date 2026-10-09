/**
 * Souls, memories and notes encrypted at rest (#301): the office's existing
 * envelope encryption (`secrets/`, AES-256-GCM, a key per value wrapped under
 * `OFFICE_MASTER_KEY`), nothing new. Every value is bound to its agent, so an
 * envelope copied onto another agent's row does not open.
 *
 * What this is for: a copy of the database (a backup file, a stolen disk
 * image) does not show what agents are or remember. It does not protect
 * against whoever runs the office: the running server holds the key and reads
 * everything, and so does root on its host.
 *
 * Without `OFFICE_MASTER_KEY` nothing can be encrypted: text is stored as it
 * is (the row says so in its `sealed` column) and the office says so in its
 * log at start. Rows written that way are encrypted at the first start with a
 * key (seal-existing.ts).
 *
 * An empty text is stored empty: there is nothing in it to protect, and the
 * envelope has no form for it.
 */
import {
  decryptSecretToString,
  encryptSecret,
  isSecretsError,
  type MasterKeyring,
} from "../../secrets/index.ts";

/** A text as a row holds it. */
export interface Sealed {
  text: string;
  sealed: boolean;
}

/** A sealed row that cannot be opened: the key is missing or is not the one it was sealed with. */
export class SealedUnreadable extends Error {
  override name = "SealedUnreadable";
  constructor() {
    // Fixed words: never anything from the row.
    super(
      "this agent's text is encrypted and cannot be read: OFFICE_MASTER_KEY is missing or is not the key it was encrypted with",
    );
  }
}

const context = (agentId: string) => ({ userId: agentId, secretName: "office-agent-mind" });

export class MindCipher {
  constructor(private readonly keyring: MasterKeyring | undefined) {}

  /** False without `OFFICE_MASTER_KEY`: text is stored as it is. */
  get on(): boolean {
    return this.keyring !== undefined;
  }

  seal(agentId: string, text: string): Sealed {
    if (!this.keyring || text === "") return { text, sealed: false };
    const { keys, current } = this.keyring;
    return { text: encryptSecret(text, context(agentId), keys, current), sealed: true };
  }

  open(agentId: string, stored: Sealed): string {
    if (!stored.sealed) return stored.text;
    if (!this.keyring) throw new SealedUnreadable();
    try {
      return decryptSecretToString(stored.text, context(agentId), this.keyring.keys);
    } catch (err) {
      if (isSecretsError(err)) throw new SealedUnreadable();
      throw err;
    }
  }
}

/** Stores text as it is: for tests and tools that build a store without a key. */
export const PLAIN = new MindCipher(undefined);

/** A memory or note's private fields; one envelope holds all three. */
export interface EntryText {
  title: string;
  text: string;
  source: string;
}

/** The columns of a memory row for these fields. */
export function sealEntry(cipher: MindCipher, agentId: string, entry: EntryText, titleKey: string) {
  if (!cipher.on) return { ...entry, titleKey, sealed: false };
  const { text } = cipher.seal(agentId, JSON.stringify(entry));
  // The title's key would give the title away: a sealed note is found by opening the agent's notes.
  return { title: "", titleKey: "", source: "", text, sealed: true };
}

export function openEntry(
  cipher: MindCipher,
  agentId: string,
  row: EntryText & { sealed: boolean },
): EntryText {
  if (!row.sealed) return { title: row.title, text: row.text, source: row.source };
  let parsed: unknown;
  try {
    parsed = JSON.parse(cipher.open(agentId, { text: row.text, sealed: true }));
  } catch (err) {
    if (err instanceof SealedUnreadable) throw err;
    throw new SealedUnreadable();
  }
  const v = (parsed ?? {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  return { title: str(v.title), text: str(v.text), source: str(v.source) };
}
