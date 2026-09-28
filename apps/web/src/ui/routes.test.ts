import { describe, expect, test } from "bun:test";
import { joinPath, matchOfficeRoute, ROUTE_PATHS, ROUTE_TABLE } from "./routes.ts";

describe("route table", () => {
  test("exposes the app routes, the ui-kit gallery and home", () => {
    expect(ROUTE_TABLE.map((r) => r.path).sort()).toEqual(
      ["/", "/join/:token", "/login", "/office", "/ui-kit"].sort(),
    );
  });

  test("matches each path and extracts the invite token", () => {
    expect(matchOfficeRoute("/login")?.id).toBe("login");
    expect(matchOfficeRoute("/office")?.id).toBe("office");
    expect(matchOfficeRoute("/")?.id).toBe("home");
    expect(matchOfficeRoute("/ui-kit")?.id).toBe("uiKit");
    const join = matchOfficeRoute("/join/abc-123");
    expect(join?.id).toBe("join");
    expect(join?.params.token).toBe("abc-123");
  });

  test("unknown paths do not match", () => {
    expect(matchOfficeRoute("/nope")).toBeNull();
    expect(matchOfficeRoute("/join")).toBeNull();
  });

  test("joinPath round-trips through the join route", () => {
    const path = joinPath("t/k=1");
    expect(path).toBe("/join/t%2Fk%3D1");
    // react-router decodes params, so the original token comes back.
    expect(matchOfficeRoute(path)?.params.token).toBe("t/k=1");
    expect(ROUTE_PATHS.join).toBe("/join/:token");
  });
});
