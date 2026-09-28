/**
 * office-server entry point (docs/SPEC.md §4). Boots config, logging, the
 * HTTP server and graceful shutdown; later milestones attach rooms, agents
 * and the rest to the same process.
 */
import { mkdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { ConfigError, loadConfig, redactConfig } from "./config.ts";
import { closeDatabase, databasePathFor, openDatabase, runMigrations } from "./db/index.ts";
import { createOfficeServer } from "./http/server.ts";
import { createShutdownController, installSignalHandlers } from "./lifecycle.ts";
import { createLogger } from "./logging.ts";

async function readVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const logger = createLogger({ level: config.logLevel });
  const version = await readVersion();
  logger.info({ version, config: redactConfig(config) }, "office-server starting");
  if (!config.masterKey) {
    logger.warn(
      "OFFICE_MASTER_KEY is not set; encrypted credential storage is unavailable (SPEC §8)",
    );
  }

  await mkdir(config.dataDir, { recursive: true });

  const dbPath = databasePathFor(config.dataDir);
  const db = openDatabase({ path: dbPath });
  runMigrations(db);
  logger.info({ path: dbPath }, "database ready");

  const shutdown = createShutdownController({ logger, timeoutMs: config.shutdownTimeoutMs });
  // Hooks run last-registered-first: the database closes after HTTP has drained.
  shutdown.register("db", () => closeDatabase(db));
  const server = createOfficeServer({ config, logger, version });
  server.health.register("db", () => {
    db.run(sql`select 1`);
    return true;
  });
  shutdown.register("http", async () => {
    await server.stop(false);
  });
  installSignalHandlers(shutdown, (code) => {
    logger.flush();
    process.exit(code);
  });
}

await main();
