/**
 * office-server entry point (docs/SPEC.md §4). Boots config, logging, the
 * HTTP server and graceful shutdown; later milestones attach rooms, agents
 * and the rest to the same process.
 */
import { mkdir } from "node:fs/promises";
import { ConfigError, loadConfig, redactConfig } from "./config.ts";
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

  const shutdown = createShutdownController({ logger, timeoutMs: config.shutdownTimeoutMs });
  const server = createOfficeServer({ config, logger, version });
  shutdown.register("http", async () => {
    await server.stop(false);
  });
  installSignalHandlers(shutdown, (code) => {
    logger.flush();
    process.exit(code);
  });
}

await main();
