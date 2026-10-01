/**
 * Before any e2e run: removes runner containers and volumes that an earlier run's teardown
 * left behind because it crashed (#215). Only the e2e prefixes (`rgo2e-*`, `rge2e-*`) older
 * than an hour are touched; see runnerCleanup.ts.
 */
import { dockerAvailable, dockerCli, sweepStale } from "./runnerCleanup.ts";

export default function globalSetup(): void {
  if (!dockerAvailable()) return;
  const removed = sweepStale(dockerCli());
  if (removed.length) console.log(`e2e: removed stale runners and volumes: ${removed.join(", ")}`);
}
