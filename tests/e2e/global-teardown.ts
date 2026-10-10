/**
 * Removes the throwaway data dir playwright.config.ts created for the office-server it
 * started, and any runner container or volume with this run's prefix (#215).
 */
import { rm } from "node:fs/promises";
import {
  dockerAvailable,
  dockerCli,
  officeRunnerPrefix,
  removeRunPrefix,
} from "./runnerCleanup.ts";

export default async function globalTeardown(): Promise<void> {
  // Only a data dir playwright.config.ts made for this run; never one the caller named.
  const dir = process.env.E2E_DATA_DIR;
  if (dir && process.env.E2E_DATA_DIR_MADE === "1") await rm(dir, { recursive: true, force: true });
  // Set by playwright.config.ts only when it started the office itself.
  const runId = process.env.E2E_RUN_ID;
  if (runId && dockerAvailable()) {
    const removed = removeRunPrefix(officeRunnerPrefix(runId), dockerCli());
    if (removed.length) console.log(`e2e: removed this run's runners: ${removed.join(", ")}`);
  }
}
