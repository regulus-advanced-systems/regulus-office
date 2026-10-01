/** Henchman skin rules (#184) over a real server with sessions: who may change them, validation, audit, republish. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SKIN_RULES_API_PATH, type SkinRule } from "@regulus/protocol";
import { robotFixture } from "@regulus/protocol/src/fixtures.ts";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { auditLog } from "../db/schema/index.ts";
import { captureLogger } from "../notifications/testing.ts";
import { createFloorRooms, type FloorRooms } from "../rooms/floor/room.ts";
import { createSkins, type Skins } from "./setup.ts";

let office: Office;
let skins: Skins;
let floors: FloorRooms;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let admin: { id: string; cookie: string };

beforeAll(async () => {
  office = startOffice();
  skins = createSkins({ db: office.db });
  skins.mount(office.server.router, office.auth);
  floors = createFloorRooms({
    source: { loadFloor: () => undefined, canEnter: () => false },
    logger: captureLogger().logger,
  });
  skins.publishTo(floors);
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
  admin = await office.signUp("Ada");
  office.db.$client.run(`update user_profiles set role = 'admin' where user_id = '${admin.id}'`);
});

afterAll(async () => {
  await office.stop();
});

const send = (path: string, method: string, cookie: string, body?: unknown, origin?: string) =>
  office.request(path, {
    method,
    cookie,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: origin ? { origin } : undefined,
  });

const skinOf = (agentId: string) => floors.robotsOn("f1").find((r) => r.agentId === agentId)?.skin;

describe("skin rules", () => {
  test("only owners and admins see or change them", async () => {
    expect((await office.request(SKIN_RULES_API_PATH)).status).toBe(401);
    expect((await send(SKIN_RULES_API_PATH, "GET", member.cookie)).status).toBe(403);
    const add = { match: "provider:codex", skinId: "chef", priority: 1 };
    expect((await send(SKIN_RULES_API_PATH, "POST", member.cookie, add)).status).toBe(403);
    expect(await (await send(SKIN_RULES_API_PATH, "GET", admin.cookie)).json()).toEqual({
      rules: [],
    });
  });

  test("bad matches, skins and priorities are refused; cross-origin writes too", async () => {
    for (const body of [
      { match: "provider:nope", skinId: "chef" },
      { match: "role:ceo", skinId: "chef" },
      { match: "office_agent:", skinId: "chef" },
      { match: "user:u1", skinId: "chef" },
      { match: "provider:codex", skinId: "pirate" },
      { match: "provider:codex", skinId: "chef", priority: 1.5 },
      { match: "provider:codex", skinId: "chef", priority: 5000 },
    ])
      expect((await send(SKIN_RULES_API_PATH, "POST", owner.cookie, body)).status).toBe(400);
    const evil = await send(
      SKIN_RULES_API_PATH,
      "POST",
      owner.cookie,
      { match: "provider:codex", skinId: "chef" },
      "https://evil.example",
    );
    expect(evil.status).toBe(403);
  });

  test("rules resolve onto published robots and republish when they change", async () => {
    floors.publishRobot("f1", { ...robotFixture, agentId: "a-codex", provider: "codex" });
    floors.publishRobot("f1", { ...robotFixture, agentId: "a-claude", provider: "claude-code" });
    expect(skinOf("a-codex")).toBe("standard");

    const created = await send(SKIN_RULES_API_PATH, "POST", owner.cookie, {
      match: "provider:codex",
      skinId: "lab_coat",
    });
    expect(created.status).toBe(201);
    const rule = (await created.json()) as SkinRule;
    expect(rule).toMatchObject({ match: "provider:codex", skinId: "lab_coat", priority: 0 });
    expect(skinOf("a-codex")).toBe("lab_coat");
    expect(skinOf("a-claude")).toBe("standard");

    // A higher-priority rule for the same robots wins.
    const black = (await (
      await send(SKIN_RULES_API_PATH, "POST", admin.cookie, {
        match: "provider:codex",
        skinId: "black_ops",
        priority: 5,
      })
    ).json()) as SkinRule;
    expect(skinOf("a-codex")).toBe("black_ops");
    const list = (await (await send(SKIN_RULES_API_PATH, "GET", owner.cookie)).json()) as {
      rules: SkinRule[];
    };
    expect(list.rules.map((r) => r.id)).toEqual([black.id, rule.id]);

    // Changing and deleting republish too; a robot published later is dressed as well.
    const patched = await send(`${SKIN_RULES_API_PATH}/${black.id}`, "PATCH", owner.cookie, {
      skinId: "number_two",
    });
    expect(patched.status).toBe(200);
    expect(skinOf("a-codex")).toBe("number_two");
    expect((await send(`${SKIN_RULES_API_PATH}/${black.id}`, "DELETE", owner.cookie)).status).toBe(
      204,
    );
    expect(skinOf("a-codex")).toBe("lab_coat");
    floors.publishRobot("f1", { ...robotFixture, agentId: "a-late", provider: "codex" });
    expect(skinOf("a-late")).toBe("lab_coat");

    expect((await send(`${SKIN_RULES_API_PATH}/nope`, "DELETE", owner.cookie)).status).toBe(404);
    expect(
      (await send(`${SKIN_RULES_API_PATH}/nope`, "PATCH", owner.cookie, { priority: 2 })).status,
    ).toBe(404);
    expect(
      (await send(`${SKIN_RULES_API_PATH}/${rule.id}`, "PATCH", owner.cookie, {})).status,
    ).toBe(400);

    const actions = office.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.targetKind === "skin_rule")
      .map((e) => e.action);
    expect(actions).toEqual([
      "skin_rule.create",
      "skin_rule.create",
      "skin_rule.update",
      "skin_rule.delete",
    ]);
  });
});
