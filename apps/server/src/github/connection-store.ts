/**
 * Storage for the office's GitHub connection (#141; SPEC §8): the single
 * `github_connection` row, with the app private key, webhook secret and org
 * PAT envelope-encrypted by the secrets module. The AAD binds each ciphertext
 * to its column (`github_connection:office|<secret>`), so a value copied into
 * another column or table does not decrypt. Plain values never leave this
 * module except to the connection service for one server-side call.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { githubConnection } from "../db/schema/index.ts";
import {
  decryptSecretToString,
  encryptSecret,
  type MasterKeyring,
  type SecretContext,
} from "../secrets/index.ts";

export const CONNECTION_ROW_ID = "office";

export type ConnectionSecret = "app_private_key" | "app_webhook_secret" | "org_pat";

export function connectionSecretContext(secret: ConnectionSecret): SecretContext {
  return { userId: `github_connection:${CONNECTION_ROW_ID}`, secretName: secret };
}

export type ConnectionRow = typeof githubConnection.$inferSelect;

export interface StoredApp {
  kind: "app";
  appId: number;
  clientId: string | null;
  slug: string | null;
  name: string | null;
  htmlUrl: string | null;
  owner: string | null;
  privateKey: string;
  webhookSecret: string | null;
  connectedAt: number;
}

export interface StoredPat {
  kind: "pat";
  token: string;
  login: string | null;
  connectedAt: number;
}

export class ConnectionStoreError extends Error {
  override name = "ConnectionStoreError";
  constructor(readonly code: "master_key_required" | "undecryptable") {
    super(code);
  }
}

export class ConnectionStore {
  readonly #db: DbOrTx;
  readonly #keyring: MasterKeyring | undefined;

  constructor(db: DbOrTx, keyring: MasterKeyring | undefined) {
    this.#db = db;
    this.#keyring = keyring;
  }

  get canStore(): boolean {
    return this.#keyring !== undefined;
  }

  #ring(): MasterKeyring {
    if (!this.#keyring) throw new ConnectionStoreError("master_key_required");
    return this.#keyring;
  }

  #seal(value: string, secret: ConnectionSecret): string {
    const ring = this.#ring();
    return encryptSecret(value, connectionSecretContext(secret), ring.keys, ring.current);
  }

  #open(envelope: string, secret: ConnectionSecret): string {
    const ring = this.#ring();
    try {
      return decryptSecretToString(envelope, connectionSecretContext(secret), ring.keys);
    } catch {
      throw new ConnectionStoreError("undecryptable");
    }
  }

  row(): ConnectionRow | undefined {
    return this.#db
      .select()
      .from(githubConnection)
      .where(eq(githubConnection.id, CONNECTION_ROW_ID))
      .get();
  }

  /** The stored connection, decrypted for one use. */
  load(): StoredApp | StoredPat | null {
    const row = this.row();
    if (!row) return null;
    const connectedAt = row.updatedAt.getTime();
    if (row.kind === "pat") {
      if (!row.encryptedToken) return null;
      return {
        kind: "pat",
        token: this.#open(row.encryptedToken, "org_pat"),
        login: row.tokenLogin,
        connectedAt,
      };
    }
    if (!row.appId || !row.encryptedPrivateKey) return null;
    return {
      kind: "app",
      appId: row.appId,
      clientId: row.appClientId,
      slug: row.appSlug,
      name: row.appName,
      htmlUrl: row.appHtmlUrl,
      owner: row.appOwner,
      privateKey: this.#open(row.encryptedPrivateKey, "app_private_key"),
      webhookSecret: row.encryptedWebhookSecret
        ? this.#open(row.encryptedWebhookSecret, "app_webhook_secret")
        : null,
      connectedAt,
    };
  }

  #replace(values: Omit<typeof githubConnection.$inferInsert, "id">): void {
    const empty = {
      appId: null,
      appClientId: null,
      appSlug: null,
      appName: null,
      appHtmlUrl: null,
      appOwner: null,
      encryptedPrivateKey: null,
      encryptedWebhookSecret: null,
      encryptedToken: null,
      tokenLogin: null,
    };
    const row = { ...empty, ...values, updatedAt: new Date() };
    this.#db
      .insert(githubConnection)
      .values({ id: CONNECTION_ROW_ID, ...row })
      .onConflictDoUpdate({ target: githubConnection.id, set: row })
      .run();
  }

  saveApp(app: Omit<StoredApp, "kind" | "connectedAt">): void {
    this.#replace({
      kind: "app",
      appId: app.appId,
      appClientId: app.clientId,
      appSlug: app.slug,
      appName: app.name,
      appHtmlUrl: app.htmlUrl,
      appOwner: app.owner,
      encryptedPrivateKey: this.#seal(app.privateKey, "app_private_key"),
      encryptedWebhookSecret: app.webhookSecret
        ? this.#seal(app.webhookSecret, "app_webhook_secret")
        : null,
    });
  }

  savePat(token: string, login: string | null): void {
    this.#replace({ kind: "pat", encryptedToken: this.#seal(token, "org_pat"), tokenLogin: login });
  }

  /** True when a row was removed. */
  clear(): boolean {
    const removed = this.#db
      .delete(githubConnection)
      .where(eq(githubConnection.id, CONNECTION_ROW_ID))
      .returning({ id: githubConnection.id })
      .all();
    return removed.length > 0;
  }
}
