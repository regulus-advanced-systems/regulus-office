/** Removes the throwaway data dir playwright.config.ts created for the office-server it started. */
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

export default async function globalTeardown(): Promise<void> {
  const dir = process.env.E2E_DATA_DIR;
  if (dir?.startsWith(tmpdir())) await rm(dir, { recursive: true, force: true });
}
