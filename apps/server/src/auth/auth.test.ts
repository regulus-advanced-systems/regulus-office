import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_GENIUS_LOOK } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { auditLog } from "../db/schema/index.ts";
import { AUDIT_ACTIONS } from "./audit.ts";
import { AuthConfigError, createAuth, SIGNUP_CLOSED_CODE } from "./auth.ts";
import { claimInvite, INVITE_TTL_MS } from "./invites.ts";
import { type Office, PASSWORD, startOffice, TEST_SECRET } from "./test-helpers.ts";

let office: Office;
let owner: { id: string; email: string; cookie: string };
let member: { id: string; email: string; cookie: string };

beforeAll(() => {
  office = startOffice();
});
afterAll(() => office.stop());

const audits = (action: string) =>
  office.db.select().from(auditLog).where(eq(auditLog.action, action)).all();

describe("registration and roles", () => {
  test("first registered user becomes owner, later ones members", async () => {
    owner = await office.signUp("Ante");
    member = await office.signUp("Mira");
    expect(await (await office.me(owner.cookie)).json()).toEqual({
      id: owner.id,
      displayName: "Ante",
      role: "owner",
      // A new human starts as the default genius until the picker saves one (#185).
      avatar: DEFAULT_GENIUS_LOOK,
      avatarChosen: false,
    });
    expect(await (await office.me(member.cookie)).json()).toMatchObject({ role: "member" });
    expect(audits(AUDIT_ACTIONS.bootstrapOwner)).toHaveLength(1);
  });

  test("session lookup from the cookie works on a bare Request (WebSocket upgrade path)", async () => {
    const req = new Request(`${office.origin}/rooms/building`, {
      headers: { cookie: owner.cookie, upgrade: "websocket" },
    });
    const session = await office.auth.getSessionFromRequest(req);
    expect(session).toMatchObject({ id: owner.id, displayName: "Ante", role: "owner" });
    expect(session?.sessionId).toBeString();
    expect(await office.auth.getSessionFromRequest(new Request(`${office.origin}/x`))).toBeNull();
    expect(
      await office.auth.getSessionFromRequest(
        new Request(`${office.origin}/x`, { headers: { cookie: "office.session_token=bogus" } }),
      ),
    ).toBeNull();
  });

  test("/api/me needs a session", async () => {
    expect((await office.me()).status).toBe(401);
  });

  test("Better Auth is mounted: sign-in and sign-out round trip", async () => {
    const res = await office.post("/api/auth/sign-in/email", {
      email: member.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("office.session_token="))).toBe(
      true,
    );
    const out = await office.post("/api/auth/sign-out", {}, { cookie: member.cookie });
    expect(out.status).toBe(200);
    expect((await office.me(member.cookie)).status).toBe(401);
    member = await office.signUp("Mira");
  });

  test("wrong password is rejected without revealing which part failed", async () => {
    const res = await office.post("/api/auth/sign-in/email", {
      email: member.email,
      password: "not the password",
    });
    expect(res.status).toBe(401);
  });
});

describe("invites", () => {
  test("members cannot create invites; admins cannot mint owner invites", async () => {
    expect(
      (await office.post("/api/invites", { role: "member" }, { cookie: member.cookie })).status,
    ).toBe(403);
    const admin = await office.signUp("Adam");
    const promote = await office.request(`/api/users/${admin.id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role: "admin" }),
      cookie: owner.cookie,
    });
    expect(promote.status).toBe(200);
    const res = await office.post("/api/invites", { role: "owner" }, { cookie: admin.cookie });
    expect(await res.json()).toEqual({ error: "owner_required" });
  });

  test("invite is single-use, sets the role, and is audited", async () => {
    const created = await office.post("/api/invites", { role: "viewer" }, { cookie: owner.cookie });
    expect(created.status).toBe(201);
    const invite = (await created.json()) as { token: string; url: string; role: string };
    expect(invite.url).toBe(`${office.origin}/join/${invite.token}`);
    expect(audits(AUDIT_ACTIONS.inviteCreate)).toHaveLength(1);

    const peek = await office.request(`/api/invites/${invite.token}`);
    expect(await peek.json()).toMatchObject({ role: "viewer" });

    const join = await office.post(`/api/join/${invite.token}`, {
      email: "guest@example.com",
      password: PASSWORD,
      name: "Guest",
    });
    expect(join.status).toBe(201);
    const joined = (await join.json()) as { id: string; role: string };
    expect(joined.role).toBe("viewer");
    const cookies = join.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("office.session_token="))).toBe(true);
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    expect(await (await office.me(cookie)).json()).toEqual({
      id: joined.id,
      displayName: "Guest",
      role: "viewer",
      avatar: DEFAULT_GENIUS_LOOK,
      avatarChosen: false,
    });
    expect(audits(AUDIT_ACTIONS.inviteConsume)).toHaveLength(1);

    const again = await office.request(`/api/invites/${invite.token}`);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "invite_invalid", reason: "used" });
    const reuse = await office.post(`/api/join/${invite.token}`, {
      email: "guest2@example.com",
      password: PASSWORD,
      name: "Guest Two",
    });
    expect(reuse.status).toBe(404);
  });

  test("invites expire after seven days", async () => {
    const created = await office.post("/api/invites", {}, { cookie: owner.cookie });
    const invite = (await created.json()) as { token: string; role: string; expiresAt: string };
    expect(invite.role).toBe("member");
    expect(new Date(invite.expiresAt).getTime()).toBe(office.clock.now + INVITE_TTL_MS);
    office.clock.now += INVITE_TTL_MS + 1;
    try {
      const res = await office.request(`/api/invites/${invite.token}`);
      expect(await res.json()).toEqual({ error: "invite_invalid", reason: "expired" });
      const join = await office.post(`/api/join/${invite.token}`, {
        email: "late@example.com",
        password: PASSWORD,
        name: "Late",
      });
      expect(join.status).toBe(404);
    } finally {
      office.clock.now -= INVITE_TTL_MS + 1;
    }
  });

  test("unknown tokens and bad bodies are rejected", async () => {
    expect((await office.request("/api/invites/nope")).status).toBe(404);
    const res = await office.post("/api/join/nope", { email: "x", password: "short", name: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });

  test("two claims of one token resolve to exactly one winner", async () => {
    const created = await office.post("/api/invites", { role: "admin" }, { cookie: owner.cookie });
    const { token } = (await created.json()) as { token: string };
    const a = await office.signUp("RaceA");
    const b = await office.signUp("RaceB");
    const first = claimInvite(office.db, { token, userId: a.id });
    const second = claimInvite(office.db, { token, userId: b.id });
    expect(first).toEqual({ ok: true, role: "admin" });
    expect(second).toEqual({ ok: false, reason: "used" });
    expect(await (await office.me(a.cookie)).json()).toMatchObject({ role: "admin" });
    expect(await (await office.me(b.cookie)).json()).toMatchObject({ role: "member" });
  });
});

describe("role changes", () => {
  const patchRole = (targetId: string, role: string, cookie: string, origin?: string) =>
    office.request(`/api/users/${targetId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
      cookie,
      headers: origin ? { origin } : undefined,
    });

  test("require an admin or owner, and only owners touch owners", async () => {
    const target = await office.signUp("Tara");
    expect((await patchRole(target.id, "admin", member.cookie)).status).toBe(403);
    expect((await patchRole(target.id, "admin", "")).status).toBe(401);

    const ok = await patchRole(target.id, "admin", owner.cookie);
    expect(await ok.json()).toEqual({ id: target.id, role: "admin", previousRole: "member" });
    expect(await (await office.me(target.cookie)).json()).toMatchObject({ role: "admin" });

    expect(await (await patchRole(owner.id, "member", target.cookie)).json()).toEqual({
      error: "owner_required",
    });
    expect(await (await patchRole(target.id, "member", target.cookie)).json()).toEqual({
      error: "cannot_change_own_role",
    });
    expect((await patchRole("no-such-user", "member", owner.cookie)).status).toBe(404);
    expect((await patchRole(target.id, "god", owner.cookie)).status).toBe(400);

    const entries = audits(AUDIT_ACTIONS.roleChange).filter((e) => e.targetId === target.id);
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]?.metaJson ?? "{}")).toEqual({ from: "member", to: "admin" });
    expect(entries[0]?.userId).toBe(owner.id);
  });

  test("cookie-bearing state changes from another origin are refused", async () => {
    const target = await office.signUp("Tom");
    const res = await patchRole(target.id, "viewer", owner.cookie, "https://evil.example");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "origin_mismatch" });
    const invite = await office.post(
      "/api/invites",
      {},
      { cookie: owner.cookie, origin: "https://evil.example" },
    );
    expect(invite.status).toBe(403);
    expect(await (await office.me(target.cookie)).json()).toMatchObject({ role: "member" });
  });
});

describe("sign-up policy", () => {
  const signUpBody = (n: number) => ({
    email: `person${n}@example.com`,
    password: PASSWORD,
    name: `Person ${n}`,
  });

  test("default: first registration is open, later ones need an invite", async () => {
    const closed = startOffice({ openSignup: false });
    try {
      expect(closed.auth.openSignup).toBe(false);
      const first = await closed.post("/api/auth/sign-up/email", signUpBody(1));
      expect(first.status).toBe(200);
      const ownerCookie = first.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      expect(await (await closed.me(ownerCookie)).json()).toMatchObject({ role: "owner" });

      const second = await closed.post("/api/auth/sign-up/email", signUpBody(2));
      expect(second.status).toBe(403);
      expect(await second.json()).toMatchObject({ code: SIGNUP_CLOSED_CODE });
      // Forging the internal marker header does not help.
      const forged = await closed.request("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify(signUpBody(2)),
        headers: { "x-office-join": "guess" },
      });
      expect(forged.status).toBe(403);
      expect(closed.db.$client.query("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });

      const created = await closed.post(
        "/api/invites",
        { role: "member" },
        { cookie: ownerCookie },
      );
      const { token } = (await created.json()) as { token: string };
      const joined = await closed.post(`/api/join/${token}`, signUpBody(2));
      expect(joined.status).toBe(201);
      expect(await joined.json()).toMatchObject({ displayName: "Person 2", role: "member" });
      // Existing accounts still sign in.
      const login = await closed.post("/api/auth/sign-in/email", {
        email: signUpBody(2).email,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
    } finally {
      await closed.stop();
    }
  });

  test("OFFICE_OPEN_SIGNUP=true lets anyone register as member", async () => {
    const open = startOffice({ openSignup: true });
    try {
      expect((await open.post("/api/auth/sign-up/email", signUpBody(1))).status).toBe(200);
      const second = await open.post("/api/auth/sign-up/email", signUpBody(2));
      expect(second.status).toBe(200);
      const cookie = second.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      expect(await (await open.me(cookie)).json()).toMatchObject({ role: "member" });
    } finally {
      await open.stop();
    }
  });
});

describe("rate limiting", () => {
  test("login attempts beyond the burst get 429 with retry-after", async () => {
    const small = startOffice({ limits: { login: { capacity: 2, refillPerSecond: 1 } } });
    try {
      const attempt = () =>
        small.post(
          "/api/auth/sign-in/email",
          { email: "nobody@example.com", password: PASSWORD },
          { ip: "203.0.113.7" },
        );
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("1");
      expect(await blocked.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 1 });
      // Another client keeps its own bucket.
      expect(
        (
          await small.post(
            "/api/auth/sign-in/email",
            { email: "nobody@example.com", password: PASSWORD },
            { ip: "203.0.113.8" },
          )
        ).status,
      ).toBe(401);
      small.clock.now += 1000;
      expect((await attempt()).status).toBe(401);
    } finally {
      await small.stop();
    }
  });

  test("invite lookups are limited too", async () => {
    const small = startOffice({ limits: { invite: { capacity: 1, refillPerSecond: 1 } } });
    try {
      expect((await small.request("/api/invites/x", { ip: "198.51.100.1" })).status).toBe(404);
      expect((await small.request("/api/invites/x", { ip: "198.51.100.1" })).status).toBe(429);
    } finally {
      await small.stop();
    }
  });
});

describe("createAuth", () => {
  test("refuses to start without BETTER_AUTH_SECRET", () => {
    expect(() =>
      createAuth({
        db: office.db,
        logger: office.auth.logger,
        config: {
          betterAuthSecret: undefined,
          publicUrl: "http://localhost:1",
          githubOAuth: undefined,
          openSignup: false,
        },
      }),
    ).toThrow(AuthConfigError);
  });

  test("GitHub login is enabled only when both client id and secret are configured", () => {
    const base = { db: office.db, logger: office.auth.logger };
    const off = createAuth({
      ...base,
      config: {
        betterAuthSecret: TEST_SECRET,
        publicUrl: "http://localhost:1",
        githubOAuth: undefined,
        openSignup: false,
      },
    });
    const on = createAuth({
      ...base,
      config: {
        betterAuthSecret: TEST_SECRET,
        publicUrl: "http://localhost:1",
        githubOAuth: { clientId: "Iv1.x", clientSecret: TEST_SECRET },
        openSignup: false,
      },
    });
    expect(off.githubEnabled).toBe(false);
    expect(on.githubEnabled).toBe(true);
  });

  test("social sign-in for GitHub is refused when the provider is off", async () => {
    const res = await office.post("/api/auth/sign-in/social", {
      provider: "github",
      callbackURL: "/",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
