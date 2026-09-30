/**
 * Usage tracker (#40; SPEC §5, §9.4, D2, D13): boot wiring.
 *
 * - `tracker` stores what adapters emit: hand it to the AgentManager as its
 *   `usage` observer; other modules record through `recordUsage`
 *   (`UsageRecorder`, e.g. workflows attributing office usage, #155).
 * - `startScanning` runs the periodic transcript scan in each human's runner.
 * - `publishTo` keeps the BuildingRoom's office totals current.
 * - `mount` serves the viewer's own limits and spend.
 */
import type { AgentAdapter } from "@regulus/agent-adapters";
import type { UsageSummary } from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import { sameUsage } from "./room-state.ts";
import { mountUsageRoutes } from "./routes.ts";
import { TranscriptScanLoop } from "./scanner.ts";
import { UsageSummaries } from "./summary.ts";
import { UsageTracker } from "./tracker.ts";

export { estimateCostUsd, PRICES, PRICES_AS_OF, priceFor } from "./prices.ts";
export type { RecordUsageInput, UsageAttribution, UsageRecorder } from "./tracker.ts";
export { TranscriptScanLoop, UsageSummaries, UsageTracker };

/** Office totals are refreshed at least this often (the day rolls over, windows reset). */
export const OFFICE_REFRESH_MS = 60_000;
/** After new usage, the office totals are re-published within this delay. */
export const OFFICE_DEBOUNCE_MS = 2_000;

export interface Usage {
  tracker: UsageTracker;
  summaries: UsageSummaries;
  mount(router: Router, auth: Pick<OfficeAuth, "getSessionFromRequest">): void;
  /** Keep a room's office usage state current (the BuildingRoom). */
  publishTo(room: { setUsage(summary: UsageSummary): void }): void;
  /** Start the periodic transcript scan with the office's Claude Code adapter. */
  startScanning(opts: { runner: Runner; adapter: AgentAdapter; officeUrl: string }): void;
  close(): Promise<void>;
}

export function createUsage(deps: { db: Db; logger: Logger; now?: () => number }): Usage {
  const logger = deps.logger.child({ component: "usage" });
  const summaries = new UsageSummaries(deps.db, deps.now);
  let room: { setUsage(summary: UsageSummary): void } | undefined;
  let last: UsageSummary | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let refresh: ReturnType<typeof setInterval> | undefined;
  let scanner: TranscriptScanLoop | undefined;

  const publish = () => {
    debounce = undefined;
    if (!room) return;
    try {
      const next = summaries.office();
      if (sameUsage(last, next)) return;
      last = next;
      room.setUsage(next);
    } catch (err) {
      logger.warn({ err: String(err) }, "office usage summary failed");
    }
  };
  const tracker = new UsageTracker(deps.db, () => {
    debounce ??= setTimeout(publish, OFFICE_DEBOUNCE_MS);
  });

  return {
    tracker,
    summaries,
    mount: (router, auth) => mountUsageRoutes(router, { auth, summaries }),
    publishTo(target) {
      room = target;
      publish();
      refresh ??= setInterval(publish, OFFICE_REFRESH_MS);
      refresh.unref?.();
    },
    startScanning({ runner, adapter, officeUrl }) {
      scanner ??= new TranscriptScanLoop({
        db: deps.db,
        runner,
        adapter,
        tracker,
        officeUrl,
        logger,
        now: deps.now,
      });
      scanner.start();
      void scanner.scanOnce();
    },
    close: async () => {
      if (debounce) clearTimeout(debounce);
      if (refresh) clearInterval(refresh);
      await scanner?.stop();
    },
  };
}
