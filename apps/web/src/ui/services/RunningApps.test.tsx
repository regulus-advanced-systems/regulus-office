import { afterEach, describe, expect, test } from "bun:test";
import type { FloorState, ServiceState } from "@regulus/protocol";
import { floorFixture } from "@regulus/protocol/src/fixtures.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { mount, useDom } from "../a11y/dom.ts";
import { RunningApps } from "./RunningApps.tsx";
import { appRows } from "./runningApps.ts";

useDom();

const svc = (id: string, patch: Partial<ServiceState> = {}): ServiceState => ({
  id,
  agentId: "a1",
  port: 5173,
  url: "/p/f1/a/a1/port/5173/",
  title: "Shop (Vite)",
  pid: 7,
  address: "0.0.0.0",
  localOnly: false,
  shared: false,
  firstSeenAt: 1,
  lastSeenAt: 2,
  ...patch,
});

const floor = (services: ServiceState[]): FloorState => ({
  ...floorFixture,
  services: Object.fromEntries(services.map((s) => [s.id, s])),
});

describe("running apps rows (client mirror of the app ACL)", () => {
  const owner = { id: "u1", role: "member" as const };
  const other = { id: "u2", role: "member" as const };
  test("the owner opens; others only when shared, read-only; localhost only never", () => {
    const state = floor([
      svc("s1"),
      svc("s2", { port: 9229, localOnly: true, url: "/p/f1/a/a1/port/9229/" }),
    ]);
    expect(appRows(state, owner).map((r) => [r.port, r.open])).toEqual([
      [5173, "control"],
      [9229, "localhost"],
    ]);
    expect(appRows(state, other).map((r) => r.open)).toEqual(["owner_only", "localhost"]);
    const shared = floor([svc("s1", { shared: true })]);
    expect(appRows(shared, other).map((r) => r.open)).toEqual(["watch"]);
    expect(appRows(shared, { id: "u1", role: "viewer" }).map((r) => r.open)).toEqual(["watch"]);
    expect(appRows(null, owner)).toEqual([]);
    expect(appRows(state, owner)[0]?.robot).toBe("Ante's claude-code robot");
  });
});

describe("<RunningApps>", () => {
  let unmount: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    useFloorStore.getState().clear();
  });

  const render = async (services: ServiceState[], userId = "u1") => {
    useSessionStore.setState({
      status: "authenticated",
      user: { id: userId, displayName: "X", role: "member" },
    });
    useFloorStore.getState().apply(floor(services));
    const m = await mount(<RunningApps />);
    unmount = m.unmount;
    return m.container;
  };

  test("hidden when no robot serves anything", async () => {
    const el = await render([]);
    expect(el.textContent).toBe("");
  });

  test("Open is a new-tab link through the proxy for the owner", async () => {
    const el = await render([svc("s1"), svc("s2", { port: 3001, localOnly: true })]);
    expect(el.querySelector("h2")?.textContent).toBe("Running apps");
    const link = el.querySelector("a[aria-label='Open Shop (Vite)']") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/p/f1/a/a1/port/5173/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(el.textContent).toContain("localhost only");
    const disabled = el.querySelectorAll("button[disabled]");
    expect(disabled).toHaveLength(1);
    expect((disabled[0] as HTMLButtonElement).title).toContain("0.0.0.0");
  });

  test("someone else's app without an app domain cannot be opened", async () => {
    const el = await render([svc("s1")], "u2");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("owner only");
  });
});
