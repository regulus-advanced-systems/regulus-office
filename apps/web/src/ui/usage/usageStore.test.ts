import { describe, expect, test } from "bun:test";
import { MY_USAGE_API_PATH } from "@regulus/protocol";
import { MINE } from "./fixtures.ts";
import { fetchMyUsage, useMyUsageStore } from "./usageStore.ts";

describe("fetchMyUsage", () => {
  test("asks for the viewer's own usage with the local offset and validates it", async () => {
    const urls: string[] = [];
    const ok = (async (url: string) => {
      urls.push(url);
      return Response.json(MINE);
    }) as unknown as typeof fetch;
    expect(await fetchMyUsage(ok, -120)).toEqual(MINE);
    expect(urls).toEqual([`${MY_USAGE_API_PATH}?tz=-120`]);
  });

  test("signed out, offline or malformed: null", async () => {
    const status = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const junk = (async () => Response.json({ limits: "nope" })) as unknown as typeof fetch;
    expect(await fetchMyUsage(status)).toBeNull();
    expect(await fetchMyUsage(offline)).toBeNull();
    expect(await fetchMyUsage(junk)).toBeNull();
  });

  test("panel toggle", () => {
    const { togglePanel } = useMyUsageStore.getState();
    togglePanel();
    expect(useMyUsageStore.getState().panelOpen).toBe(true);
    togglePanel(false);
    expect(useMyUsageStore.getState().panelOpen).toBe(false);
  });
});
