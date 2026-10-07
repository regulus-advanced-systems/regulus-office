import { describe, expect, test } from "bun:test";
import { DEFAULT_GENIUS_LOOK, type GeniusLookValue } from "@regulus/protocol";
import type { SessionUser } from "../auth/auth.ts";
import {
  composeRoomAuth,
  createDevHeaderAuth,
  createSessionRoomAuth,
  DEV_USER_HEADER,
  denyAllAuth,
  type RoomAuthUser,
} from "./auth.ts";

const TEAL_SCIENTIST: GeniusLookValue = {
  ...DEFAULT_GENIUS_LOOK,
  archetype: "scientist",
  outfit: "teal",
  accessory: "goggles",
};

const request = (header?: string) =>
  new Request("http://office.test/matchmake/joinOrCreate/building", {
    headers: header === undefined ? {} : { [DEV_USER_HEADER]: header },
  });

describe("dev header auth", () => {
  const auth = createDevHeaderAuth({ NODE_ENV: "test" });

  test("refuses to exist in production", () => {
    expect(() => createDevHeaderAuth({ NODE_ENV: "production" })).toThrow(/production/);
  });

  test("parses a JSON user with defaults", async () => {
    const user = await auth.authenticate(
      request(JSON.stringify({ userId: "u1", displayName: "Ada" })),
    );
    expect(user).toEqual({
      userId: "u1",
      displayName: "Ada",
      role: "member",
      avatar: DEFAULT_GENIUS_LOOK,
    });
  });

  test("keeps an explicit role and avatar", async () => {
    const user = await auth.authenticate(
      request(
        JSON.stringify({
          userId: "u2",
          displayName: "Bob",
          role: "owner",
          avatar: { archetype: "hacker", outfit: "teal", accessory: "visor", skin: "nope" },
        }),
      ),
    );
    expect(user?.role).toBe("owner");
    // Valid fields are kept; an unknown one falls back to the default genius's.
    expect(user?.avatar).toEqual({
      ...DEFAULT_GENIUS_LOOK,
      archetype: "hacker",
      outfit: "teal",
      accessory: "visor",
    });
  });

  test("rejects a missing, malformed or invalid header", async () => {
    expect(await auth.authenticate(request())).toBeNull();
    expect(await auth.authenticate(request("not json"))).toBeNull();
    expect(await auth.authenticate(request(JSON.stringify({ userId: "u1" })))).toBeNull();
    expect(
      await auth.authenticate(
        request(JSON.stringify({ userId: "u1", displayName: "x", role: "root" })),
      ),
    ).toBeNull();
  });
});

describe("composeRoomAuth", () => {
  const fixed: RoomAuthUser = {
    userId: "u9",
    displayName: "Nine",
    role: "admin",
    avatar: DEFAULT_GENIUS_LOOK,
  };

  test("returns the first user found and null when nobody matches", async () => {
    const composed = composeRoomAuth([denyAllAuth, { authenticate: async () => fixed }]);
    expect(await composed.authenticate(request())).toEqual(fixed);
    expect(await composeRoomAuth([denyAllAuth]).authenticate(request())).toBeNull();
  });
});

describe("session room auth", () => {
  const session: SessionUser = {
    id: "u-1",
    email: "ada@example.com",
    displayName: "Ada",
    role: "owner",
    avatar: TEAL_SCIENTIST,
    avatarChosen: true,
    sessionId: "s-1",
    sessionExpiresAt: new Date(0),
  };

  test("maps a session to the room user and passes cookies through untouched", async () => {
    const seen: Request[] = [];
    const auth = createSessionRoomAuth({
      getSessionFromRequest: async (req) => {
        seen.push(req);
        return req.headers.get("cookie") === "office.session_token=abc" ? session : null;
      },
    });
    const withCookie = new Request("http://office.test/matchmake/joinOrCreate/building", {
      headers: { cookie: "office.session_token=abc" },
    });
    expect(await auth.authenticate(withCookie)).toEqual({
      userId: "u-1",
      displayName: "Ada",
      role: "owner",
      avatar: TEAL_SCIENTIST,
      // The seat ends with this session (live access, #244).
      sessionId: "s-1",
    });
    expect(await auth.authenticate(request())).toBeNull();
    expect(seen).toHaveLength(2);
  });
});
