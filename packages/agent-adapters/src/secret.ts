/**
 * Secret-bearing values (SPEC §8 rule 2).
 *
 * Decrypted API keys, plan keys and per-agent hook tokens travel from the
 * secrets store to the runner inside these wrappers. Every accidental
 * serialisation path (`String()`, template literals, `JSON.stringify`,
 * `console.log` / `Bun.inspect`, pino) prints a redaction marker instead of
 * the value. Only a runner backend calls `reveal()`, at exec time, to hand the
 * values to the agent process. Nothing else should.
 */

export const REDACTED = "[redacted]";

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

/** One secret string (API key, plan key, hook token). */
export class Secret {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): Secret {
    if (value.length === 0) throw new Error("Secret value must not be empty");
    return new Secret(value);
  }

  /** The plaintext. Call only where the value leaves the office for the runner. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspectSymbol](): string {
    return `Secret(${REDACTED})`;
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Environment for an agent process. Treated as secret-bearing as a whole:
 * adapters put decrypted keys here (e.g. `ANTHROPIC_API_KEY`,
 * `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` for a base-URL profile), so
 * names are visible for debugging but values never are.
 *
 * Runner backends must not place revealed values on a command line (visible in
 * `ps`) or in logs; pass them through the process environment or a 0600 file
 * that is removed after it is sourced.
 */
export class SecretEnv {
  readonly #vars: ReadonlyMap<string, string>;

  private constructor(vars: ReadonlyMap<string, string>) {
    this.#vars = vars;
  }

  static empty(): SecretEnv {
    return new SecretEnv(new Map());
  }

  static of(vars: Readonly<Record<string, string | Secret>>): SecretEnv {
    const map = new Map<string, string>();
    for (const [name, value] of Object.entries(vars)) {
      map.set(checkName(name), typeof value === "string" ? value : value.reveal());
    }
    return new SecretEnv(map);
  }

  /** A copy with `name` set; `SecretEnv` itself is immutable. */
  with(name: string, value: string | Secret): SecretEnv {
    const map = new Map(this.#vars);
    map.set(checkName(name), typeof value === "string" ? value : value.reveal());
    return new SecretEnv(map);
  }

  /** A copy with every variable of `other` added (other wins on conflicts). */
  merge(other: SecretEnv): SecretEnv {
    return new SecretEnv(new Map([...this.#vars, ...other.#vars]));
  }

  has(name: string): boolean {
    return this.#vars.has(name);
  }

  /** Variable names only; safe to log. */
  names(): string[] {
    return [...this.#vars.keys()].sort();
  }

  get size(): number {
    return this.#vars.size;
  }

  /** Plaintext name→value map. Only runner backends call this, at exec time. */
  reveal(): Record<string, string> {
    return Object.fromEntries(this.#vars);
  }

  toString(): string {
    return `SecretEnv(${this.names().join(", ")})`;
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.names().map((name) => [name, REDACTED]));
  }

  [inspectSymbol](): string {
    return this.toString();
  }
}

function checkName(name: string): string {
  if (!ENV_NAME.test(name)) throw new Error(`Invalid environment variable name: ${name}`);
  return name;
}
