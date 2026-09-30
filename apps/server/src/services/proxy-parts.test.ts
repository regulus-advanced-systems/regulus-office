/** Unit tests of the proxy's pieces: ACL, app domain tokens, header and URL rewriting. */
import { describe, expect, test } from "bun:test";
import { decideAppAccess, methodAllowed } from "./access.ts";
import {
  AppTokens,
  appCookieHeader,
  appDomainFrom,
  appLabel,
  parseAppHost,
  safeReturnPath,
  TICKET_TTL_MS,
} from "./app-domain.ts";
import {
  type ForwardContext,
  isOfficeCookie,
  requestHeaders,
  rewriteLocation,
  rewriteSetCookie,
  stripOfficeCookies,
  upstreamUrl,
} from "./proxy-http.ts";
import { parseServicePath, readCookie } from "./route.ts";

describe("app ACL (D12 spirit)", () => {
  const app = { ownerUserId: "u1", floorId: "f1" };
  const sees = () => true;
  const blind = () => false;
  test.each([
    ["owner", { id: "u1", role: "member" as const }, false, "control" as const],
    ["owner, app domain", { id: "u1", role: "member" as const }, true, "control" as const],
    ["teammate, app domain", { id: "u2", role: "member" as const }, true, "watch" as const],
    ["admin, app domain", { id: "u3", role: "admin" as const }, true, "watch" as const],
    ["viewer owning it, app domain", { id: "u1", role: "viewer" as const }, true, "watch" as const],
  ])("%s", (_name, user, isolated, access) => {
    expect(decideAppAccess(user, app, sees, isolated)).toEqual({ ok: true, access });
  });

  test("others on the office origin, and anyone without floor access, are refused", () => {
    expect(decideAppAccess({ id: "u2", role: "member" }, app, sees, false)).toEqual({
      ok: false,
      status: 403,
      reason: "owner_only",
    });
    expect(decideAppAccess({ id: "u2", role: "owner" }, app, sees, false).ok).toBe(false);
    expect(decideAppAccess({ id: "u1", role: "member" }, app, blind, true)).toEqual({
      ok: false,
      status: 404,
      reason: "not_found",
    });
  });

  test("watchers only read", () => {
    expect(methodAllowed("watch", "GET")).toBe(true);
    expect(methodAllowed("watch", "head")).toBe(true);
    expect(methodAllowed("watch", "POST")).toBe(false);
    expect(methodAllowed("watch", "OPTIONS")).toBe(false);
    expect(methodAllowed("control", "DELETE")).toBe(true);
  });
});

describe("app domain", () => {
  const d = appDomainFrom("Apps.Office.Example.", "https://office.example");
  test("config", () => {
    expect(d).toEqual({ domain: "apps.office.example", protocol: "https:", portSuffix: "" });
    expect(appDomainFrom(undefined, "https://office.example")).toBeNull();
    expect(() => appDomainFrom("office.example", "https://office.example")).toThrow();
    expect(() => appDomainFrom("not a domain", "https://office.example")).toThrow();
    expect(appDomainFrom("apps.localhost", "http://localhost:4600")?.portSuffix).toBe(":4600");
  });

  test("labels", () => {
    const id = "0b6f1c2e-7a53-4a8e-9a0c-2f3c1b9d4e11";
    expect(appLabel(id, 5173)).toBe(`5173-${id}`);
    expect(appLabel("Has_Upper", 1)).toBeNull();
    if (!d) throw new Error("no domain");
    expect(parseAppHost(d, `5173-${id}.apps.office.example`)).toEqual({
      agentId: id,
      port: 5173,
      label: `5173-${id}`,
    });
    expect(parseAppHost(d, "office.example")).toBeNull();
    expect(parseAppHost(d, "5173-a.b.apps.office.example")).toBeNull();
    expect(parseAppHost(d, "99999-a.apps.office.example")).toBeNull();
    expect(parseAppHost(d, "x.evil-apps.office.example")).toBeNull();
  });

  test("tickets: single use, bound to robot and port, expire", () => {
    let now = 1_000;
    const tokens = new AppTokens({ now: () => now });
    const t = tokens.ticket({ userId: "u1", agentId: "a1", port: 3000 });
    expect(tokens.redeemTicket(t, "a1", 3001)).toBeNull();
    expect(tokens.redeemTicket(t, "a1", 3000)).toEqual({ userId: "u1", agentId: "a1", port: 3000 });
    expect(tokens.redeemTicket(t, "a1", 3000)).toBeNull();
    const late = tokens.ticket({ userId: "u1", agentId: "a1", port: 3000 });
    now += TICKET_TTL_MS + 1;
    expect(tokens.redeemTicket(late, "a1", 3000)).toBeNull();
  });

  test("cookies are not tickets, and are signed with the office's key", () => {
    const tokens = new AppTokens();
    const c = tokens.cookie({ userId: "u1", agentId: "a1", port: 3000 });
    expect(tokens.verifyCookie(c, "a1", 3000)?.userId).toBe("u1");
    expect(tokens.redeemTicket(c, "a1", 3000)).toBeNull();
    expect(new AppTokens().verifyCookie(c, "a1", 3000)).toBeNull();
    const [body] = c.split(".");
    expect(tokens.verifyCookie(`${body}.AAAA`, "a1", 3000)).toBeNull();
    expect(appCookieHeader("https:", "v")).toContain("__Host-office.app=v; Path=/; HttpOnly");
    expect(appCookieHeader("https:", "v")).toContain("Secure");
  });

  test("return paths stay on the app host", () => {
    expect(safeReturnPath("/a?b=1")).toBe("/a?b=1");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath(null)).toBe("/");
  });
});

describe("forwarding", () => {
  const ctx: ForwardContext = {
    target: { host: "rg-sbx-a1", sandboxed: true },
    port: 5173,
    prefix: "/p/f1/a/a1/port/5173/",
    publicHost: "office.example",
    publicProto: "https",
    clientIp: "203.0.113.9",
  };

  test("office cookies and headers never reach the app", () => {
    expect(isOfficeCookie("office.session_token")).toBe(true);
    expect(isOfficeCookie("__Secure-office.session_token")).toBe(true);
    expect(isOfficeCookie("__Host-office.app")).toBe(true);
    expect(isOfficeCookie("officer")).toBe(false);
    expect(stripOfficeCookies("office.session_token=s; a=1; __Secure-office.x=y; b=2")).toBe(
      "a=1; b=2",
    );
    expect(stripOfficeCookies("office.session_token=s")).toBeNull();
    const h = requestHeaders(
      new Headers({
        cookie: "office.session_token=s; a=1",
        "x-office-dev-user": "u1",
        "x-forwarded-for": "1.2.3.4",
        forwarded: "for=1.2.3.4",
        connection: "keep-alive",
        accept: "text/html",
      }),
      ctx,
    );
    expect(Object.fromEntries(h)).toEqual({
      accept: "text/html",
      cookie: "a=1",
      host: "localhost:5173",
      "x-forwarded-host": "office.example",
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-prefix": "/p/f1/a/a1/port/5173",
    });
  });

  test("the upstream URL is the registry's host, whatever the path says", () => {
    const t = ctx.target;
    expect(upstreamUrl(t, 5173, "/x?y=1")).toBe("http://rg-sbx-a1:5173/x?y=1");
    expect(upstreamUrl(t, 5173, "//evil.example/x")).toBe("http://rg-sbx-a1:5173//evil.example/x");
    expect(upstreamUrl(t, 5173, "/@evil.example/")).toBe("http://rg-sbx-a1:5173/@evil.example/");
    expect(upstreamUrl(t, 5173, "/hmr", true)).toBe("ws://rg-sbx-a1:5173/hmr");
    expect(() => upstreamUrl(t, 5173, "evil.example")).toThrow();
  });

  test("Set-Cookie: no office names, no Domain, Path under the prefix", () => {
    expect(rewriteSetCookie("office.session_token=x; Path=/", ctx.prefix)).toBeNull();
    expect(rewriteSetCookie("__Host-a=1; Path=/; Secure", ctx.prefix)).toBeNull();
    expect(rewriteSetCookie("a=1; Domain=office.example; Path=/; HttpOnly", ctx.prefix)).toBe(
      "a=1; Path=/p/f1/a/a1/port/5173; HttpOnly",
    );
    expect(rewriteSetCookie("a=1; Path=/p/f1/a/a1/port/5173/api", ctx.prefix)).toBe(
      "a=1; Path=/p/f1/a/a1/port/5173/api",
    );
    expect(rewriteSetCookie("a=1; Domain=apps.office.example", "")).toBe("a=1; Path=/");
  });

  test("redirects stay on the proxy", () => {
    expect(rewriteLocation("http://localhost:5173/login?x=1", ctx)).toBe(
      "/p/f1/a/a1/port/5173/login?x=1",
    );
    expect(rewriteLocation("http://rg-sbx-a1:5173/", ctx)).toBe("/p/f1/a/a1/port/5173/");
    expect(rewriteLocation("/p/f1/a/a1/port/5173/ok", ctx)).toBe("/p/f1/a/a1/port/5173/ok");
    expect(rewriteLocation("/login", ctx)).toBe("/p/f1/a/a1/port/5173/login");
    expect(rewriteLocation("https://github.com/login", ctx)).toBe("https://github.com/login");
    expect(rewriteLocation("/login", { ...ctx, prefix: "" })).toBe("/login");
  });

  test("paths and cookies", () => {
    expect(parseServicePath("/p/f1/a/a1/port/5173/x/y")).toEqual({
      floorId: "f1",
      agentId: "a1",
      port: 5173,
      rest: "/x/y",
    });
    expect(parseServicePath("/p/f1/a/a1/port/5173")?.rest).toBe("");
    expect(parseServicePath("/p/f1/port/5173/")).toBeNull();
    expect(parseServicePath("/p/f1/a/a1/port/0/")).toBeNull();
    expect(parseServicePath("/p/f1/a/a1/port/70000/")).toBeNull();
    expect(readCookie("a=1; office.app=x.y=; b=2", "office.app")).toBe("x.y=");
  });
});
