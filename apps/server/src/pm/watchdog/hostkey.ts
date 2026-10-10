/**
 * A watched host's public key (#253): how it is stored, compared and shown.
 *
 * The office keeps a host's pin in its own row, as `keytype base64` lines
 * (the address is added when a `known_hosts` file is written for a check).
 * It comes from an admin when the host is added, or from the first contact,
 * and from then on every check uses `StrictHostKeyChecking=yes` with exactly
 * these keys. A host that shows another key fails its check; the key it
 * showed is kept beside the pin as *offered*, and only an admin's explicit
 * "accept new key" makes it the pin.
 */
import { createHash } from "node:crypto";

const KEY_LINE = /^(?:\S+\s+)?((?:ssh-|ecdsa-|sk-)[A-Za-z0-9@.-]+)\s+([A-Za-z0-9+/]+=*)(?:\s.*)?$/;

/**
 * `known_hosts` or `ssh-keyscan` text as `keytype base64` lines, sorted and
 * without repeats. Comment lines and anything that is not a key are dropped.
 */
export function keyLines(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = KEY_LINE.exec(line);
    if (match) out.add(`${match[1]} ${match[2]}`);
  }
  return [...out].sort();
}

/** The stored form of a pin: `keyLines` joined. Empty when the text holds no key. */
export const pinOf = (text: string): string => keyLines(text).join("\n");

/** The `known_hosts` file for one check: the pin, under the address ssh will look up. */
export function knownHostsFile(host: string, port: number, pin: string): string {
  const address = port === 22 ? host : `[${host}]:${port}`;
  return `${keyLines(pin)
    .map((line) => `${address} ${line}`)
    .join("\n")}\n`;
}

/** `SHA256:...` as `ssh-keygen -lf` prints it, with the key type, for each key. */
export function fingerprints(pin: string): string[] {
  return keyLines(pin).map((line) => {
    const [type, blob] = line.split(" ");
    const digest = createHash("sha256")
      .update(Buffer.from(blob ?? "", "base64"))
      .digest("base64")
      .replace(/=+$/, "");
    return `${type} SHA256:${digest}`;
  });
}
