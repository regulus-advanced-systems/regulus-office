/** Renamed environment variables keep working under their old name (#226). */
import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { deprecatedEnvMessage, withRenamedEnv } from "./deprecated-env.ts";

describe("renamed env vars", () => {
  test("the old name still sets the value, with a deprecation warning", () => {
    const c = loadConfig({ OFFICE_DOCKER_FLOOR_ROOTS: "/srv/a,/srv/b" });
    expect(c.docker.operationRoots).toEqual(["/srv/a", "/srv/b"]);
    expect(c.deprecatedEnv).toEqual([
      { old: "OFFICE_DOCKER_FLOOR_ROOTS", now: "OFFICE_DOCKER_OPERATION_ROOTS", used: true },
    ]);
    expect(deprecatedEnvMessage(c.deprecatedEnv?.[0] ?? { old: "", now: "", used: true })).toBe(
      "OFFICE_DOCKER_FLOOR_ROOTS is deprecated; rename it to OFFICE_DOCKER_OPERATION_ROOTS",
    );
  });

  test("the new name wins when both are set", () => {
    const c = loadConfig({
      OFFICE_DOCKER_FLOOR_ROOTS: "/srv/old",
      OFFICE_DOCKER_OPERATION_ROOTS: "/srv/new",
    });
    expect(c.docker.operationRoots).toEqual(["/srv/new"]);
    expect(c.deprecatedEnv?.map((d) => d.used)).toEqual([false]);
    expect(deprecatedEnvMessage({ old: "A", now: "B", used: false })).toContain("ignored");
  });

  test("nothing to report when only the new name is used", () => {
    expect(loadConfig({ OFFICE_DOCKER_OPERATION_ROOTS: "/srv/x" }).deprecatedEnv).toEqual([]);
    expect(withRenamedEnv({ OFFICE_PORT: "1" })).toEqual({
      env: { OFFICE_PORT: "1" },
      deprecated: [],
    });
  });
});
