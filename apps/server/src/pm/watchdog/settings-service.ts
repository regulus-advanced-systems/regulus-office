/**
 * Setting the watchdog up, for office owners and admins (#253, D30): which
 * agent does the rounds, the fix rule, Sentry, the hosts and their keys.
 *
 * Rooms (D26, D27: running the office opens no room):
 * - a target can be put only into a room the admin can see themselves;
 * - a target that is in a room the admin cannot see is shown as "a room you
 *   cannot see", with no id and no name, and its room cannot be changed or
 *   taken away by that admin. They can stop watching the target altogether:
 *   its row is then kept as "not watched", with its room, so that adding the
 *   same name again is a change to that row and not a new target in a room of
 *   their choosing. Only someone who sees the room watches it again or
 *   deletes it for good.
 *
 * Stored credentials (the SSH key of a host, the Sentry token) are the
 * office's. Pointing one at something new (a new app on the host, another
 * address, a new Sentry project, another Sentry organisation) is for the
 * office owner, or for an admin who gives the credential again in the same
 * request: an admin who has it could read those logs anyway, one who does not
 * cannot borrow the office's copy.
 *
 * Secrets: an SSH key and the Sentry token go in and never come out (a host
 * shows `hasKey`, Sentry `hasToken`). The audit log says which fields
 * changed, never a value.
 */
import {
  type SaveWatchdogHost,
  type SetWatchdogSentryProjects,
  type UpdateWatchdogSettings,
  WATCHDOG_LIMITS,
  type WatchdogHostView,
  type WatchdogSettingsView,
} from "@regulus/protocol";
import type { z } from "zod";
import { AUDIT_ACTIONS, type AuditAction, writeAudit } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import {
  isOfficeManager,
  type OperationActor,
  operationAccessFor,
} from "../../operations/access.ts";
import type { OfficeAgentStore } from "../store.ts";
import { WatchdogError } from "./errors.ts";
import { fingerprints } from "./hostkey.ts";
import type { HostProbe } from "./probe.ts";
import { fitToWatch } from "./rounds.ts";
import { WatchdogSecretError, type WatchdogStore } from "./store.ts";

export interface SettingsServiceDeps {
  db: Db;
  store: WatchdogStore;
  agents: OfficeAgentStore;
  probe: HostProbe | undefined;
}

type HostInput = z.output<typeof SaveWatchdogHost>;
type ProjectsInput = z.output<typeof SetWatchdogSentryProjects>;
type SettingsInput = z.output<typeof UpdateWatchdogSettings>;
interface Mapped {
  operationId: string | null;
  watched: boolean;
}

const CREDENTIAL = {
  host: "adding an app to a host or changing its address uses its stored key: give the key again, or ask the office owner",
  sentry:
    "adding a project or changing the organisation uses the stored token: give the token again, or ask the office owner",
};

export class WatchdogSettingsService {
  constructor(private readonly deps: SettingsServiceDeps) {}

  #sees(actor: OperationActor, operationId: string): boolean {
    return operationAccessFor(this.deps.db, actor, operationId) !== null;
  }

  #manager(actor: OperationActor): void {
    if (!isOfficeManager(actor.role)) throw new WatchdogError("owner_or_admin_required");
  }

  #audit(actor: OperationActor, action: AuditAction, targetId: string | null, meta = {}): void {
    writeAudit(this.deps.db, {
      userId: actor.id,
      action,
      targetKind: "watchdog",
      targetId,
      meta,
    });
  }

  /**
   * The room an admin gives a target (`undefined`: keep what is set).
   * It must be one they can see. A target that is in a room they cannot see
   * keeps it: they can neither move it, nor take its room away, nor watch it
   * again once it is not watched; and whatever room they name for it, the
   * answer is the same, so it tells nothing of where the target is.
   */
  #room(actor: OperationActor, wanted: string | null | undefined, now: Mapped | undefined): void {
    if (now && now.operationId !== null && !this.#sees(actor, now.operationId)) {
      if (wanted !== undefined || !now.watched) throw new WatchdogError("room_not_yours");
      return;
    }
    if (typeof wanted === "string" && !this.#sees(actor, wanted)) {
      throw new WatchdogError("no_such_room");
    }
  }

  /** A target that leaves the list is kept, not watched, when its room is not the actor's to see. */
  #retain(actor: OperationActor) {
    return (row: { operationId: string | null }) =>
      row.operationId !== null && !this.#sees(actor, row.operationId);
  }

  /**
   * A stored credential is pointed at something new: for the office owner, or
   * with the credential given again. Returns how it was allowed, for the audit log.
   */
  #credential(actor: OperationActor, given: boolean, what: keyof typeof CREDENTIAL) {
    if (given) return "given_again" as const;
    if (actor.role === "owner") return "owner" as const;
    throw new WatchdogError("credential_required", CREDENTIAL[what]);
  }

  #mapping(actor: OperationActor, row: Mapped) {
    const hidden = row.operationId !== null && !this.#sees(actor, row.operationId);
    return {
      operationId: hidden ? null : row.operationId,
      operationHidden: hidden,
      watched: row.watched,
    };
  }

  #secrets<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof WatchdogSecretError) throw new WatchdogError("master_key_required");
      throw err;
    }
  }

  #hostView(actor: OperationActor, hostId: string): WatchdogHostView {
    const { store } = this.deps;
    const host = store.host(hostId);
    if (!host) throw new WatchdogError("not_found");
    return {
      id: host.id,
      label: host.label,
      host: host.host,
      port: host.port,
      username: host.username,
      hasKey: host.encryptedKey.length > 0,
      pinned: fingerprints(host.hostKey),
      pinnedBy: host.hostKey ? host.hostKeySource : "none",
      offered: fingerprints(host.offeredHostKey),
      ...(host.offeredAt ? { offeredAt: host.offeredAt.getTime() } : {}),
      apps: store
        .apps(host.id, true)
        .map((app) => ({ id: app.id, name: app.name, ...this.#mapping(actor, app) })),
    };
  }

  view(actor: OperationActor): WatchdogSettingsView {
    this.#manager(actor);
    const { store, agents } = this.deps;
    const s = store.settings();
    const by = s.autoFixUserId ? agents.person(s.autoFixUserId) : undefined;
    return {
      enabled: s.enabled,
      agentId: s.agentId,
      agents: agents
        .ownedBy(null)
        .filter(fitToWatch)
        .map((a) => ({ id: a.id, name: a.name })),
      intervalMinutes: s.intervalMinutes,
      fixMode: s.fixMode,
      fixProvider: s.fixProvider,
      fixModel: s.fixModel,
      autoFixPerRound: s.autoFixPerRound,
      autoFixPerDay: s.autoFixPerDay,
      autoFixBy: s.fixMode === "auto" && by ? { userId: by.id, displayName: by.displayName } : null,
      sentry: {
        host: s.sentryHost,
        organization: s.sentryOrganization,
        hasToken: s.encryptedSentryToken !== null,
        projects: store.sentryProjects(true).map((p) => ({
          id: p.id,
          slug: p.slug,
          ...this.#mapping(actor, p),
        })),
      },
      hosts: store.hosts().map((h) => this.#hostView(actor, h.id)),
      canStore: store.canStore,
    };
  }

  update(actor: OperationActor, input: SettingsInput): WatchdogSettingsView {
    this.#manager(actor);
    const { store, agents, probe } = this.deps;
    const { sentryToken, ...rest } = input;
    const before = store.settings();
    if (typeof rest.agentId === "string") {
      const agent = agents.get(rest.agentId);
      if (!agent || agent.ownerUserId !== null || agent.role !== "watchdog") {
        throw new WatchdogError("not_a_watchdog");
      }
      if (!fitToWatch(agent)) {
        throw new WatchdogError(
          "engine_not_supported",
          "the watchdog must run as a Claude Code session in the office: a Hermes agent cannot do rounds",
        );
      }
    }
    // The stored token read from another organisation is the token pointed at something new.
    const orgChanged =
      rest.sentryOrganization !== undefined &&
      rest.sentryOrganization !== before.sentryOrganization &&
      before.sentryOrganization !== "" &&
      before.encryptedSentryToken !== null;
    const allowedBy = orgChanged
      ? this.#credential(actor, typeof sentryToken === "string", "sentry")
      : undefined;
    store.update({
      ...rest,
      // `auto` runs fixes in the name of whoever switched it on; `ask` in nobody's.
      ...(rest.fixMode === undefined
        ? {}
        : { autoFixUserId: rest.fixMode === "auto" ? actor.id : null }),
    });
    // A token is for one Sentry: it is never sent to another host than the one it was typed for.
    const hostChanged = rest.sentryHost !== undefined && rest.sentryHost !== before.sentryHost;
    const tokenCleared =
      hostChanged && sentryToken === undefined && before.encryptedSentryToken !== null;
    if (tokenCleared) store.setSentryToken(null);
    if (sentryToken !== undefined) this.#secrets(() => store.setSentryToken(sentryToken));
    // Another agent does the rounds now: the one before leaves nothing behind.
    if (rest.agentId !== undefined && before.agentId && before.agentId !== rest.agentId) {
      void probe?.forget(before.agentId);
    }
    // Which fields changed; never a value (one of them may be a token).
    this.#audit(actor, AUDIT_ACTIONS.watchdogSettings, null, {
      fields: Object.keys(input).sort(),
      ...(tokenCleared ? { tokenCleared: true } : {}),
      ...(allowedBy ? { organizationChanged: allowedBy } : {}),
    });
    return this.view(actor);
  }

  setSentryProjects(actor: OperationActor, input: ProjectsInput): WatchdogSettingsView {
    this.#manager(actor);
    const { store } = this.deps;
    const now = new Map(store.sentryProjects(true).map((p) => [p.slug, p]));
    for (const project of input.projects) {
      this.#room(actor, project.operationId, now.get(project.slug));
    }
    const added = input.projects.filter((p) => !now.has(p.slug)).length;
    const allowedBy =
      added > 0 && store.settings().encryptedSentryToken !== null
        ? this.#credential(actor, input.sentryToken !== undefined, "sentry")
        : undefined;
    const { sentryToken } = input;
    if (sentryToken !== undefined) this.#secrets(() => store.setSentryToken(sentryToken));
    store.setSentryProjects(input.projects, this.#retain(actor));
    const after = store.sentryProjects(true);
    this.#audit(actor, AUDIT_ACTIONS.watchdogSentryProjects, null, {
      count: input.projects.length,
      ...(added > 0 ? { added, ...(allowedBy ? { onStoredToken: allowedBy } : {}) } : {}),
      ...(sentryToken !== undefined ? { tokenReplaced: true } : {}),
      // Left the list, kept as "not watched": their room is not this person's to see.
      keptUnwatched: after.filter((p) => !p.watched && now.get(p.slug)?.watched).length,
    });
    return this.view(actor);
  }

  saveHost(actor: OperationActor, id: string | undefined, input: HostInput): WatchdogHostView {
    this.#manager(actor);
    const { store } = this.deps;
    const before = id === undefined ? undefined : store.host(id);
    if (id !== undefined && !before) throw new WatchdogError("not_found");
    const was = before ? store.apps(before.id, true) : [];
    const apps = new Map(was.map((a) => [a.name, a]));
    for (const app of input.apps) this.#room(actor, app.operationId, apps.get(app.name));
    if (id === undefined) {
      if (!input.privateKey) throw new WatchdogError("private_key_required");
      if (store.hosts().length >= WATCHDOG_LIMITS.hostsMax) {
        throw new WatchdogError("too_many_hosts");
      }
    }
    const added = before ? input.apps.filter((a) => !apps.has(a.name)).length : 0;
    const moved =
      before !== undefined && (before.host !== input.host || before.port !== input.port);
    // The stored key read from a new app, or from another machine: the owner, or the key again.
    const allowedBy =
      added > 0 || moved
        ? this.#credential(actor, input.privateKey !== undefined, "host")
        : undefined;
    const row = this.#secrets(() => store.saveHost(id, input, actor.id, this.#retain(actor)));
    if (!row) throw new WatchdogError("not_found");
    const watchedBefore = new Set(was.filter((a) => a.watched).map((a) => a.id));
    this.#audit(actor, AUDIT_ACTIONS.watchdogHostSave, row.id, {
      created: id === undefined,
      keyReplaced: input.privateKey !== undefined,
      apps: input.apps.length,
      ...(added > 0 ? { appsAdded: added } : {}),
      // Another address is another machine: its pin does not carry over.
      ...(moved ? { moved: true, pin: row.hostKey === "" ? "first_contact" : "given" } : {}),
      ...(before && before.hostKey !== "" && row.hostKey === "" ? { pinCleared: true } : {}),
      ...(allowedBy ? { onStoredKey: allowedBy } : {}),
      keptUnwatched: store.apps(row.id, true).filter((a) => !a.watched && watchedBefore.has(a.id))
        .length,
    });
    return this.#hostView(actor, row.id);
  }

  /** An admin accepts the key a host shows now in place of its pin. Explicit, and audited. */
  acceptHostKey(actor: OperationActor, id: string): WatchdogHostView {
    this.#manager(actor);
    const { store } = this.deps;
    const before = store.host(id);
    if (!before) throw new WatchdogError("not_found");
    const done = store.pins.accept(id);
    if (done === "unread") {
      // The pin stays: accepting a key nobody saw would be trusting whatever comes next.
      throw new WatchdogError(
        "nothing_offered",
        "the host showed another key, but the office could not read which; there is nothing to accept yet",
      );
    }
    if (done !== "accepted") throw new WatchdogError("nothing_offered");
    // Fingerprints of public keys: what was pinned and what is pinned now.
    this.#audit(actor, AUDIT_ACTIONS.watchdogHostKeyAccept, id, {
      from: fingerprints(before.hostKey),
      to: fingerprints(before.offeredHostKey),
    });
    return this.#hostView(actor, id);
  }

  /**
   * Stop watching a host. Its apps in rooms the person cannot see are kept as
   * "not watched", and the host with them (false: it is still there).
   */
  deleteHost(actor: OperationActor, id: string): boolean {
    this.#manager(actor);
    const done = this.deps.store.deleteHost(id, this.#retain(actor));
    if (!done) throw new WatchdogError("not_found");
    this.#audit(actor, AUDIT_ACTIONS.watchdogHostDelete, id, { kept: done === "kept" });
    return done === "deleted";
  }
}
