/**
 * Boot wiring for the watchdog (#253): its stores, the SSH probe, Sentry over
 * REST, its tools, the schedule and the REST routes.
 *
 * Reports: findings people were not told of yet go to the reporters. The
 * office UI is the one registered here (`OfficeUiReporter`: a push to each
 * person who may see at least one of the findings; the list itself is
 * `GET /api/watchdog`). The office PM's Discord channel (#258) registers
 * another with `addReporter`; nothing here knows about Discord.
 */
import {
  WATCHDOG_ALERT_MESSAGE,
  WATCHDOG_REPORT_MESSAGE,
  type WatchdogAlertPush,
  type WatchdogReportPush,
} from "@regulus/protocol";
import type { OfficeAuth } from "../../auth/auth.ts";
import type { Db } from "../../db/index.ts";
import { userProfiles } from "../../db/schema/index.ts";
import type { Router } from "../../http/router.ts";
import type { Logger } from "../../logging.ts";
import { isOfficeManager } from "../../operations/access.ts";
import type { Runner } from "../../runners/types.ts";
import type { MasterKeyring } from "../../secrets/index.ts";
import type { AgentRuntime } from "../runtime.ts";
import type { OfficeAgentStore } from "../store.ts";
import type { OfficeTools } from "../tools/call.ts";
import { FindingStore } from "./findings.ts";
import { type FixPorts, WatchdogFixes } from "./fix.ts";
import { watchdogFrame } from "./frame.ts";
import { RoundStore } from "./parts.ts";
import { type HostProbe, SshProbe } from "./probe.ts";
import { RoundTools } from "./round-tools.ts";
import { type WatchdogReporter, type WatchdogRoundReport, WatchdogRounds } from "./rounds.ts";
import { mountWatchdogRoutes } from "./routes.ts";
import { httpSentryApi, type SentryApi } from "./sentry-api.ts";
import { SentryNotes } from "./sentry-notes.ts";
import { WatchdogService } from "./service.ts";
import { WatchdogSettingsService } from "./settings-service.ts";
import { WatchdogStore } from "./store.ts";
import { ToldStore } from "./told.ts";

export const WATCHDOG_TICK_MS = 60_000;

/** Delivers a BuildingRoom message to every client of one person (`BuildingRoom.sendToUser`). */
export interface WatchdogSink {
  sendToUser(userId: string, type: string, payload: unknown): void;
  /** Whether a client of this person is connected right now. Absent: taken as connected. */
  connected?(userId: string): boolean;
}

export interface WatchdogOptions {
  db: Db;
  keyring: MasterKeyring | undefined;
  logger: Logger;
  agents: OfficeAgentStore;
  runtime: AgentRuntime;
  tools: OfficeTools;
  /** Absent: hosts cannot be read (tests give their own `probe`). */
  runner?: Pick<Runner, "provision" | "spawnPiped">;
  probe?: HostProbe;
  /** Program overrides for `ssh` and `ssh-keyscan` (tests: stand-ins). */
  sshCommand?: string;
  keyscanCommand?: string;
  /** Sentry's REST API (tests: a stand-in). */
  sentry?: SentryApi;
  /** How long reading one Sentry project may take in a part (tests: short). */
  sentryDeadlineMs?: number;
  now?: () => number;
}

export interface Watchdog {
  store: WatchdogStore;
  findings: FindingStore;
  parts: RoundStore;
  rounds: WatchdogRounds;
  service: WatchdogService;
  settings: WatchdogSettingsService;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
  /** The queue and the henchmen, once they exist: without them no fix can be started. */
  bind(ports: Partial<FixPorts>): void;
  /** Where the office UI's push goes (the BuildingRoom). */
  setSink(sink: WatchdogSink): void;
  /** One more place findings are told (the Discord channel of #258). */
  addReporter(reporter: WatchdogReporter): void;
  /** An office agent was removed: if it did rounds, what it could have left on its runner goes too. */
  agentRemoved(agentId: string): Promise<void>;
  /** Call once at boot, after the migrations. */
  boot(): void;
  /** Start the schedule. */
  start(tickMs?: number): void;
  close(): void;
}

/**
 * The office UI's share: a push to each person who is connected, with the
 * count they may see. A person who is not connected is not told yet: their
 * client asks when it next connects (`WatchdogService.news`), so nothing is
 * lost when nobody is there, as at the start of the office.
 */
export class OfficeUiReporter implements WatchdogReporter {
  sink: WatchdogSink | undefined;

  constructor(
    private readonly db: Db,
    private readonly service: WatchdogService,
  ) {}

  #people() {
    return this.db
      .select({ id: userProfiles.userId, role: userProfiles.role })
      .from(userProfiles)
      .all();
  }

  roundEnded(report: WatchdogRoundReport): void {
    if (!this.sink) return;
    for (const person of this.#people()) {
      if (this.sink.connected?.(person.id) === false) continue;
      const findings = this.service.tell(person);
      if (findings === 0) continue;
      const push: WatchdogReportPush = {
        roundId: report.roundId,
        findings,
        agentName: report.agentName.slice(0, 40),
      };
      this.sink.sendToUser(person.id, WATCHDOG_REPORT_MESSAGE, push);
    }
  }

  /** A watched host shows another key than its pin: for the people who run the office. */
  hostKeyChanged(host: { id: string; label: string }): void {
    if (!this.sink) return;
    const push: WatchdogAlertPush = {
      kind: "host_key_changed",
      hostId: host.id,
      hostLabel: host.label.slice(0, 60),
    };
    for (const person of this.#people()) {
      if (isOfficeManager(person.role)) {
        this.sink.sendToUser(person.id, WATCHDOG_ALERT_MESSAGE, push);
      }
    }
  }
}

export function createWatchdog(opts: WatchdogOptions): Watchdog {
  const { db, agents, runtime, tools } = opts;
  const now = opts.now ?? Date.now;
  const logger = opts.logger.child({ module: "watchdog" });
  const store = new WatchdogStore(db, opts.keyring, now);
  const findings = new FindingStore(db, now);
  const parts = new RoundStore(db, now);
  const sentry = opts.sentry ?? httpSentryApi();
  const probe =
    opts.probe ??
    (opts.runner
      ? new SshProbe({
          runner: opts.runner,
          logger,
          now,
          command: opts.sshCommand,
          keyscanCommand: opts.keyscanCommand,
        })
      : undefined);
  let ports: Partial<FixPorts> = {};
  const fixes = new WatchdogFixes({
    db,
    findings,
    settings: () => store.settings(),
    person: (userId) => {
      const person = agents.person(userId);
      return person ? { id: person.id, role: person.role } : undefined;
    },
    ports: () => ports,
    logger,
    now,
  });
  const notes = new SentryNotes({
    store,
    findings,
    sentry,
    agentName: () => rounds.agent()?.name ?? "The watchdog",
    logger,
  });
  const rounds: WatchdogRounds = new WatchdogRounds({
    store,
    findings,
    parts,
    agents,
    runtime,
    fixes,
    notes,
    logger,
    now,
  });
  const told = new ToldStore(db);
  const service = new WatchdogService({ db, store, findings, parts, rounds, fixes, told, now });
  const settings = new WatchdogSettingsService({ db, store, agents, probe });
  const ui = new OfficeUiReporter(db, service);
  rounds.addReporter(ui);

  // How the watchdog works, in place of the office's usual frame; and its tools.
  runtime.frame = (row, turn) => watchdogFrame(row, turn);
  const offInstructed = runtime.onInstructed((result) => rounds.instructed(result));
  tools.bindWatchdog(
    new RoundTools({
      store,
      findings,
      parts,
      rounds,
      fixes,
      check: {
        store,
        findings,
        probe,
        sentry,
        logger,
        now,
        hostKeyChanged: (host) => ui.hostKeyChanged(host),
        sentryDeadlineMs: opts.sentryDeadlineMs,
      },
      report: (person) => service.reportFor(person),
    }),
  );

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    store,
    findings,
    parts,
    rounds,
    service,
    settings,
    mount: (router, auth) => mountWatchdogRoutes(router, { auth, service, settings }),
    bind(next) {
      ports = { ...ports, ...next };
    },
    setSink(sink) {
      ui.sink = sink;
    },
    addReporter: (reporter) => rounds.addReporter(reporter),
    agentRemoved: async (agentId) => {
      await probe?.forget(agentId);
    },
    boot: () => rounds.boot(),
    start(tickMs = WATCHDOG_TICK_MS) {
      if (timer) return;
      timer = setInterval(() => void rounds.tick(), tickMs);
      (timer as { unref?: () => void }).unref?.();
    },
    close() {
      if (timer) clearInterval(timer);
      timer = undefined;
      offInstructed();
    },
  };
}
