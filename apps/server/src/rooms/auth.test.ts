import { describe, expect, test } from "bun:test";
import type { SessionUser } from "../auth/auth.ts";
import {
  composeRoomAuth,
  createDevHeaderAuth,
  createSessionRoomAuth,
  DEV_USER_HEADER,
  denyAllAuth,
  type RoomAuthUser,
} from "./auth.ts";

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
      avatar: { colorSet: "default", accessory: "none" },
    });
  });

  test("keeps an explicit role and avatar", async () => {
    const user = await auth.authenticate(
      request(
        JSON.stringify({
          userId: "u2",
          displayName: "Bob",
          role: "owner",
          avatar: { colorSet: "teal", accessory: "cap" },
        }),
      ),
    );
    expect(user?.role).toBe("owner");
    expect(user?.avatar).toEqual({ colorSet: "teal", accessory: "cap" });
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
    avatar: { colorSet: "default", accessory: "none" },
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
    avatar: { colorSet: "teal", accessory: "visor" },
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
      avatar: { colorSet: "teal", accessory: "visor" },
    });
    expect(await auth.authenticate(request())).toBeNull();
    expect(seen).toHaveLength(2);
  });
});
