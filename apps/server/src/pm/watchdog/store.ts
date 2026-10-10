/**
 * What the watchdog watches (#253, D30): its settings, the hosts with their
 * PM2 apps, the Sentry projects, and the two kinds of secret it needs.
 *
 * Secrets (SPEC §8): a host's SSH private key and the Sentry token are
 * envelope-encrypted with the office master key, each bound to its own row,
 * so an envelope copied to another row does not decrypt. They go in through
 * `saveHost` / `setSentryToken` and come out only through `hostKey` and
 * `sentryToken`, which the round calls right before the process that needs
 * them is started. No view, log line or error carries one.
 *
 * No authorisation here: service.ts decides who may call what.
 */

import { Secret } from "@regulus/agent-adapters";
import type { ProviderId, WatchdogFixMode } from "@regulus/protocol";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { watchdogApps, watchdogHosts, watchdogSettings } from "../../db/schema/index.ts";
import {
  decryptSecretToString,
  encryptSecret,
  type MasterKeyring,
  type SecretContext,
} from "../../secrets/index.ts";
import { HostPins } from "./host-pins.ts";
import { pinOf } from "./hostkey.ts";
import type { PartGroup } from "./parts.ts";
import type { AppMarks } from "./pm2.ts";
import {
  listProjects,
  type ProjectInput,
  type Retain,
  setProjects,
  setUnread,
  type WatchdogSentryProjectRow,
} from "./sentry-projects.ts";

export type WatchdogSettingsRow = typeof watchdogSettings.$inferSelect;
export type WatchdogHostRow = typeof watchdogHosts.$inferSelect;
export type WatchdogAppRow = typeof watchdogApps.$inferSelect;
export type { Retain, WatchdogSentryProjectRow } from "./sentry-projects.ts";

const SETTINGS_ID = "office";

export const sentryTokenContext = (): SecretContext => ({
  userId: `watchdog_settings:${SETTINGS_ID}`,
  secretName: "sentry_token",
});
export const hostKeyContext = (hostId: string): SecretContext => ({
  userId: `watchdog_host:${hostId}`,
  secretName: "ssh_private_key",
});

/** The office has no master key, or a stored secret no longer decrypts. Carries no secret. */
export class WatchdogSecretError extends Error {
  override name = "WatchdogSecretError";
  constructor(readonly code: "master_key_required" | "undecryptable") {
    super(code);
  }
}

export interface HostInput {
  label: string;
  host: string;
  port: number;
  username: string;
  hostKey: string;
  privateKey?: string;
  /** `operationId` undefined: keep what the app of that name has. */
  apps: ReadonlyArray<{ name: string; operationId?: string | null }>;
}

export interface SettingsPatch {
  enabled?: boolean;
  agentId?: string | null;
  intervalMinutes?: number;
  fixMode?: WatchdogFixMode;
  fixProvider?: ProviderId;
  fixModel?: string;
  autoFixUserId?: string | null;
  autoFixPerRound?: number;
  autoFixPerDay?: number;
  sentryHost?: string;
  sentryOrganization?: string;
}

/** OpenSSH wants Unix line ends and a final newline. */
const normalizeKey = (key: string) => `${key.replace(/\r\n?/g, "\n").trim()}\n`;

const NEVER: Retain = () => false;

export class WatchdogStore {
  /** The hosts' pinned public keys. */
  readonly pins: HostPins;

  constructor(
    readonly db: Db,
    private readonly keyring: MasterKeyring | undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.pins = new HostPins(db, now);
  }

  get canStore(): boolean {
    return this.keyring !== undefined;
  }

  #ring(): MasterKeyring {
    if (!this.keyring) throw new WatchdogSecretError("master_key_required");
    return this.keyring;
  }

  #open(envelope: string, context: SecretContext): Secret {
    try {
      return Secret.of(decryptSecretToString(envelope, context, this.#ring().keys));
    } catch (err) {
      if (err instanceof WatchdogSecretError) throw err;
      throw new WatchdogSecretError("undecryptable");
    }
  }

  // ---- Settings ----------------------------------------------------------------

  settings(): WatchdogSettingsRow {
    const row = this.db
      .select()
      .from(watchdogSettings)
      .where(eq(watchdogSettings.id, SETTINGS_ID))
      .get();
    if (row) return row;
    this.db.insert(watchdogSettings).values({ id: SETTINGS_ID }).onConflictDoNothing().run();
    return this.db
      .select()
      .from(watchdogSettings)
      .where(eq(watchdogSettings.id, SETTINGS_ID))
      .get() as WatchdogSettingsRow;
  }

  update(patch: SettingsPatch): WatchdogSettingsRow {
    this.settings();
    if (Object.keys(patch).length > 0) {
      this.db.update(watchdogSettings).set(patch).where(eq(watchdogSettings.id, SETTINGS_ID)).run();
    }
    return this.settings();
  }

  /** A round was started now: the schedule counts from here. */
  markRound(): void {
    this.settings();
    this.db
      .update(watchdogSettings)
      .set({ lastRoundAt: new Date(this.now()) })
      .where(eq(watchdogSettings.id, SETTINGS_ID))
      .run();
  }

  /** Store the Sentry token, or remove it with null. */
  setSentryToken(token: string | null): void {
    this.settings();
    const ring = token === null ? undefined : this.#ring();
    this.db
      .update(watchdogSettings)
      .set({
        encryptedSentryToken:
          token === null || !ring
            ? null
            : encryptSecret(token, sentryTokenContext(), ring.keys, ring.current),
      })
      .where(eq(watchdogSettings.id, SETTINGS_ID))
      .run();
  }

  /** The Sentry token, decrypted for the process about to be started; null when none is stored. */
  sentryToken(): Secret | null {
    const envelope = this.settings().encryptedSentryToken;
    return envelope ? this.#open(envelope, sentryTokenContext()) : null;
  }

  // ---- Sentry projects -----------------------------------------------------------

  /** The watched projects; `all`: also those kept as "not watched". */
  sentryProjects(all = false): WatchdogSentryProjectRow[] {
    return listProjects(this.db, all);
  }

  setSentryProjects(projects: readonly ProjectInput[], retain: Retain = NEVER): void {
    setProjects(this.db, projects, retain);
  }

  /** Sentry has more new issues of these projects than was read, from `since` on; or (null) no more. */
  setUnread(projectIds: readonly string[], since: number | null): void {
    setUnread(this.db, projectIds, since);
  }

  // ---- Hosts and apps --------------------------------------------------------------

  hosts(): WatchdogHostRow[] {
    return this.db.select().from(watchdogHosts).orderBy(asc(watchdogHosts.createdAt)).all();
  }

  host(id: string): WatchdogHostRow | undefined {
    return this.db.select().from(watchdogHosts).where(eq(watchdogHosts.id, id)).get();
  }

  /** The watched apps (of one host); `all`: also those kept as "not watched". */
  apps(hostId?: string, all = false): WatchdogAppRow[] {
    const query = this.db.select().from(watchdogApps);
    return (hostId ? query.where(eq(watchdogApps.hostId, hostId)) : query)
      .orderBy(asc(watchdogApps.name))
      .all()
      .filter((row) => all || row.watched);
  }

  app(id: string): WatchdogAppRow | undefined {
    return this.db.select().from(watchdogApps).where(eq(watchdogApps.id, id)).get();
  }

  /** Create a host (`id` undefined; needs a private key) or change one. Undefined: no such host. */
  saveHost(
    id: string | undefined,
    input: HostInput,
    by: string,
    retain: Retain = NEVER,
  ): WatchdogHostRow | undefined {
    const hostId = id ?? crypto.randomUUID();
    const seal = (key: string) => {
      const ring = this.#ring();
      return encryptSecret(normalizeKey(key), hostKeyContext(hostId), ring.keys, ring.current);
    };
    return this.db.transaction((tx) => {
      const fields = {
        label: input.label,
        host: input.host,
        port: input.port,
        username: input.username,
      };
      if (id === undefined) {
        if (!input.privateKey) throw new Error("a new host needs a private key");
        const pin = pinOf(input.hostKey);
        tx.insert(watchdogHosts)
          .values({
            id: hostId,
            ...fields,
            hostKey: pin,
            hostKeySource: pin ? "given" : "none",
            encryptedKey: seal(input.privateKey),
            createdBy: by,
          })
          .run();
      } else {
        const row = tx.select().from(watchdogHosts).where(eq(watchdogHosts.id, id)).get();
        if (!row) return undefined;
        // Saving a host never drops its pin. Another address is another machine: its pin is
        // not this one's. It gets the key given with the change, or none until first contact
        // (and the caller says so in the audit log).
        const moved = row.host !== input.host || row.port !== input.port;
        const pin = moved ? pinOf(input.hostKey) : "";
        tx.update(watchdogHosts)
          .set({
            ...fields,
            ...(moved
              ? {
                  hostKey: pin,
                  hostKeySource: pin ? ("given" as const) : ("none" as const),
                  offeredHostKey: "",
                  offeredAt: null,
                }
              : {}),
            ...(input.privateKey ? { encryptedKey: seal(input.privateKey) } : {}),
          })
          .where(eq(watchdogHosts.id, id))
          .run();
      }
      const before = new Map(
        tx
          .select()
          .from(watchdogApps)
          .where(eq(watchdogApps.hostId, hostId))
          .all()
          .map((row) => [row.name, row]),
      );
      const keep = new Set<string>();
      for (const app of input.apps) {
        if (keep.has(app.name)) continue;
        keep.add(app.name);
        const row = before.get(app.name);
        if (!row) {
          tx.insert(watchdogApps)
            .values({ hostId, name: app.name, operationId: app.operationId ?? null })
            .run();
        } else {
          tx.update(watchdogApps)
            .set({
              watched: true,
              ...(app.operationId !== undefined ? { operationId: app.operationId } : {}),
            })
            .where(eq(watchdogApps.id, row.id))
            .run();
        }
      }
      for (const row of before.values()) {
        if (keep.has(row.name)) continue;
        const one = eq(watchdogApps.id, row.id);
        if (retain(row)) tx.update(watchdogApps).set({ watched: false }).where(one).run();
        else tx.delete(watchdogApps).where(one).run();
      }
      return tx.select().from(watchdogHosts).where(eq(watchdogHosts.id, hostId)).get();
    });
  }

  /**
   * Stop watching a host. It is deleted with its key, unless one of its apps
   * is retained: then those stay as "not watched" and the host with them.
   */
  deleteHost(id: string, retain: Retain = NEVER): "deleted" | "kept" | undefined {
    return this.db.transaction((tx) => {
      const host = eq(watchdogHosts.id, id);
      if (!tx.select().from(watchdogHosts).where(host).get()) return undefined;
      let kept = 0;
      for (const row of tx.select().from(watchdogApps).where(eq(watchdogApps.hostId, id)).all()) {
        const one = eq(watchdogApps.id, row.id);
        if (retain(row)) {
          kept += 1;
          tx.update(watchdogApps).set({ watched: false }).where(one).run();
        } else tx.delete(watchdogApps).where(one).run();
      }
      if (kept > 0) return "kept";
      tx.delete(watchdogHosts).where(host).run();
      return "deleted";
    });
  }

  /** The rooms that have watched targets, and `office` when a target has no room: a round's parts. */
  groups(sentry: boolean): PartGroup[] {
    const rooms = new Set<string | null>();
    for (const app of this.apps()) rooms.add(app.operationId);
    if (sentry) for (const project of this.sentryProjects()) rooms.add(project.operationId);
    return [...rooms]
      .sort((a, b) => (a ?? "").localeCompare(b ?? ""))
      .map((operationId) => ({ scope: operationId === null ? "office" : "room", operationId }));
  }

  /** The host's private key, decrypted for the `ssh` about to be started. */
  hostKey(host: Pick<WatchdogHostRow, "id" | "encryptedKey">): Secret {
    return this.#open(host.encryptedKey, hostKeyContext(host.id));
  }

  marksOf(app: WatchdogAppRow): AppMarks {
    return { restarts: app.lastRestarts, status: app.lastStatus, logMark: app.lastLogMark };
  }

  /** What a finished round read, kept for the next one. */
  saveMarks(marks: Readonly<Record<string, AppMarks>>): void {
    this.db.transaction((tx) => {
      for (const [appId, m] of Object.entries(marks)) {
        tx.update(watchdogApps)
          .set({ lastRestarts: m.restarts, lastStatus: m.status, lastLogMark: m.logMark })
          .where(eq(watchdogApps.id, appId))
          .run();
      }
    });
  }
}
