/** PUT /api/me/avatar (#185): server-side validation of the genius look, over a real server. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DEFAULT_GENIUS_LOOK,
  GENIUS_AVATAR_API_PATH,
  type GeniusLookValue,
} from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { mountProfileRoutes } from "./routes.ts";

let office: Office;
let ada: { id: string; cookie: string };
const pushed: Array<[string, GeniusLookValue]> = [];

const HACKER: GeniusLookValue = {
  archetype: "hacker",
  outfit: "teal",
  trim: "onyx",
  skin: "brown",
  hair: "auburn",
  accessory: "visor",
};

beforeAll(async () => {
  office = startOffice();
  mountProfileRoutes(office.server.router, {
    auth: office.auth,
    onAvatarChanged: (userId, look) => pushed.push([userId, look]),
  });
  ada = await office.signUp("Ada");
});

afterAll(() => office.stop());

const put = (body: unknown, opts: { cookie?: string; origin?: string } = {}) =>
  office.request(GENIUS_AVATAR_API_PATH, {
    method: "PUT",
    cookie: opts.cookie ?? ada.cookie,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: opts.origin ? { origin: opts.origin } : undefined,
  });

const me = async () => (await office.me(ada.cookie)).json();

describe("PUT /api/me/avatar", () => {
  test("a new human has the default genius and has not chosen yet", async () => {
    expect(await me()).toMatchObject({ avatar: DEFAULT_GENIUS_LOOK, avatarChosen: false });
  });

  test("saves a valid look, marks it chosen and pushes it to the room", async () => {
    const res = await put({ ...HACKER, extra: "dropped" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatar: HACKER, avatarChosen: true });
    expect(await me()).toMatchObject({ avatar: HACKER, avatarChosen: true });
    expect(pushed.at(-1)).toEqual([ada.id, HACKER]);
  });

  test("rejects unknown archetypes, colours and accessories, naming the fields", async () => {
    const cases: Array<[unknown, string[]]> = [
      [{ ...HACKER, archetype: "pirate" }, ["archetype", "accessory"]],
      [{ ...HACKER, outfit: "#ff0000" }, ["outfit"]],
      [{ ...HACKER, skin: "green", hair: 3 }, ["skin", "hair"]],
      // An accessory of another archetype is not allowed.
      [{ ...HACKER, accessory: "tiara" }, ["accessory"]],
      [{ ...HACKER, accessory: undefined }, ["accessory"]],
      [[], ["archetype", "outfit", "trim", "skin", "hair", "accessory"]],
    ];
    const before = pushed.length;
    for (const [body, fields] of cases) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body", fields });
    }
    expect(pushed.length).toBe(before);
    expect(await me()).toMatchObject({ avatar: HACKER });
  });

  test("'none' is valid for every archetype", async () => {
    const res = await put({ ...HACKER, archetype: "diva", accessory: "none" });
    expect(res.status).toBe(200);
  });

  test("needs a session, the office origin, JSON and a small body", async () => {
    expect((await put(HACKER, { cookie: "office.session_token=nope" })).status).toBe(401);
    expect((await put(HACKER, { origin: "https://evil.example" })).status).toBe(403);
    expect((await put("{not json")).status).toBe(400);
    expect((await put({ ...HACKER, pad: "x".repeat(4096) })).status).toBe(413);
  });
});
