/**
 * /healthz: liveness plus optional readiness checks registered by subsystems
 * (the DB will register one). 200 when every check passes, 503 otherwise.
 */
import { json } from "./router.ts";

export type HealthCheck = () => boolean | Promise<boolean>;

export interface HealthOptions {
  version: string;
  startedAt?: number;
}

export interface HealthReport {
  status: "ok" | "degraded";
  version: string;
  uptimeSeconds: number;
  checks: Record<string, "ok" | "fail">;
}

export class Health {
  readonly #checks = new Map<string, HealthCheck>();
  readonly #version: string;
  readonly #startedAt: number;

  constructor(options: HealthOptions) {
    this.#version = options.version;
    this.#startedAt = options.startedAt ?? Date.now();
  }

  /** Registers a named readiness check; returns an unregister function. */
  register(name: string, check: HealthCheck): () => void {
    if (this.#checks.has(name)) throw new Error(`health check already registered: ${name}`);
    this.#checks.set(name, check);
    return () => {
      this.#checks.delete(name);
    };
  }

  async report(): Promise<HealthReport> {
    const checks: Record<string, "ok" | "fail"> = {};
    let ok = true;
    for (const [name, check] of this.#checks) {
      let passed = false;
      try {
        passed = await check();
      } catch {
        passed = false;
      }
      checks[name] = passed ? "ok" : "fail";
      ok &&= passed;
    }
    return {
      status: ok ? "ok" : "degraded",
      version: this.#version,
      uptimeSeconds: Math.round((Date.now() - this.#startedAt) / 1000),
      checks,
    };
  }

  handler = async (): Promise<Response> => {
    const report = await this.report();
    return json(report, {
      status: report.status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  };
}
