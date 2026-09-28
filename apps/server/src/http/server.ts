/**
 * The office HTTP server: Bun.serve + Router, with request logging, metrics
 * and the SPA static fallback wrapped around every request.
 */
import type { OfficeConfig } from "../config.ts";
import type { Logger } from "../logging.ts";
import { Health } from "./health.ts";
import { MetricsRegistry, PROMETHEUS_CONTENT_TYPE } from "./metrics.ts";
import { json, Router } from "./router.ts";
import { createStaticHandler } from "./static.ts";

export interface OfficeServerOptions {
  config: Pick<OfficeConfig, "port" | "host" | "webDist">;
  logger: Logger;
  version: string;
}

export interface OfficeServer {
  readonly url: URL;
  readonly port: number;
  readonly router: Router;
  readonly metrics: MetricsRegistry;
  readonly health: Health;
  /** Stops accepting connections and waits for in-flight requests; `force` drops them. */
  stop(force?: boolean): Promise<void>;
}

/** Paths that probes hit constantly; logged at debug instead of info. */
const QUIET_PATHS = new Set(["/healthz", "/metrics"]);

export function createOfficeServer(options: OfficeServerOptions): OfficeServer {
  const { config, logger, version } = options;
  const router = new Router();
  const metrics = new MetricsRegistry();
  const health = new Health({ version });
  const serveStatic = createStaticHandler({ distDir: config.webDist });

  const requestsTotal = metrics.counter("http_requests_total", "HTTP requests by route and status");
  const requestDuration = metrics.histogram(
    "http_request_duration_seconds",
    "HTTP request latency by route",
  );
  const inFlight = metrics.gauge("http_requests_in_flight", "Requests currently being handled");
  metrics
    .gauge("process_start_time_seconds", "Unix time the server started")
    .set(Date.now() / 1000);
  metrics.gauge("office_build_info", "Build metadata; value is always 1").set(1, { version });

  router.get("/healthz", health.handler);
  router.get("/metrics", () => {
    return new Response(metrics.expose(), { headers: { "content-type": PROMETHEUS_CONTENT_TYPE } });
  });

  const dispatch = async (request: Request, url: URL): Promise<[Response, string]> => {
    const match = router.match(request.method, url.pathname);
    if (match) {
      const ctx = { request, url, params: match.params };
      return [await match.handler(ctx), match.pattern];
    }
    if (router.hasPath(url.pathname)) {
      return [json({ error: "method_not_allowed" }, { status: 405 }), "405"];
    }
    return [await serveStatic(request, url), "static"];
  };

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    development: false,
    async fetch(request) {
      const url = new URL(request.url);
      const start = performance.now();
      inFlight.inc();
      let route = "error";
      let response: Response;
      try {
        [response, route] = await dispatch(request, url);
      } catch (err) {
        logger.error(
          { err, method: request.method, path: url.pathname },
          "unhandled request error",
        );
        response = json({ error: "internal_error" }, { status: 500 });
      } finally {
        inFlight.dec();
      }
      const seconds = (performance.now() - start) / 1000;
      const labels = { method: request.method, route };
      requestsTotal.inc({ ...labels, status: String(response.status) });
      requestDuration.observe(seconds, labels);
      const entry = {
        method: request.method,
        path: url.pathname,
        status: response.status,
        ms: Math.round(seconds * 1000),
      };
      if (QUIET_PATHS.has(url.pathname)) logger.debug(entry, "request");
      else logger.info(entry, "request");
      return response;
    },
    error(err) {
      logger.error({ err }, "server error");
      return json({ error: "internal_error" }, { status: 500 });
    },
  });

  logger.info({ url: String(server.url), webDist: config.webDist }, "http listening");

  return {
    url: server.url,
    port: server.port ?? config.port,
    router,
    metrics,
    health,
    async stop(force = false) {
      await server.stop(force);
      logger.info({ force }, "http stopped");
    },
  };
}
