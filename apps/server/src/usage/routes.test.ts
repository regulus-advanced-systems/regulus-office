/** The viewer's own usage over HTTP, with real sessions (#40). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MY_USAGE_API_PATH, MyUsage } from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { createLogger } from "../logging.ts";
import { createUsage } from "./index.ts";

let office: Office;
let ada: { id: string; cookie: string };
let bob: { id: string; cookie: string };

beforeAll(async () => {
  office = startOffice();
  const usage = createUsage({ db: office.db, logger: createLogger({ level: "silent" }) });
  usage.mount(office.server.router, office.auth);
  ada = await office.signUp("Ada");
  bob = await office.signUp("Bob");
  const limit = (usedPct: number) => ({
    windowKind: "seven_day" as const,
    usedPct,
    observedAt: Date.now(),
    source: "inband" as const,
  });
  usage.tracker.limit(ada.id, "codex", limit(12));
  usage.tracker.limit(bob.id, "codex", limit(88));
  usage.tracker.recordUsage({
    attributedTo: { userId: bob.id },
    provider: "codex",
    sample: {
      ts: Date.now(),
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsdEstimate: 7.5,
      source: "inband",
    },
  });
});

afterAll(async () => {
  await office.stop();
});

describe(MY_USAGE_API_PATH, () => {
  test("needs a session", async () => {
    const res = await office.request(MY_USAGE_API_PATH, { method: "GET" });
    expect(res.status).toBe(401);
  });

  test("answers with the caller's own data only, whatever the query says", async () => {
    const res = await office.request(`${MY_USAGE_API_PATH}?tz=-120&userId=${bob.id}`, {
      method: "GET",
      cookie: ada.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = MyUsage.parse(await res.json());
    expect(body.limits.map((l) => l.usedPct)).toEqual([12]);
    expect(body.today.costUsd).toBe(0);
    const mine = await office.request(MY_USAGE_API_PATH, { method: "GET", cookie: bob.cookie });
    const b = MyUsage.parse(await mine.json());
    expect(b.limits.map((l) => l.usedPct)).toEqual([88]);
    expect(b.today.costUsd).toBe(7.5);
  });
});
