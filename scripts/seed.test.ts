/**
 * scripts/seed.ts against a real office-server (invite-only sign-up) over HTTP:
 * owner bootstrap with a generated password, refusal to create a second owner,
 * sign-in with existing credentials to mint another invite.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startOffice } from "../apps/server/src/auth/test-helpers.ts";
import {
  DEFAULT_URL,
  formatResult,
  generatePassword,
  parseSeedArgs,
  SeedError,
  type SeedOptions,
  seed,
} from "./seed.ts";

describe("parseSeedArgs", () => {
  test("flags win over env, defaults fill the rest", () => {
    const opts = parseSeedArgs(["--email", "a@example.com", "--url", "https://office.test/x"], {
      SEED_OWNER_EMAIL: "env@example.com",
      SEED_INVITE_ROLE: "admin",
    });
    expect(opts).toEqual({
      url: "https://office.test",
      email: "a@example.com",
      name: "Owner",
      password: undefined,
      role: "admin",
      insecure: false,
      json: false,
    });
  });

  test("env fallbacks and localhost defaults to accepting the internal CA", () => {
    const opts = parseSeedArgs([], {
      OFFICE_PUBLIC_URL: "https://localhost",
      SEED_OWNER_EMAIL: "o@example.com",
      SEED_OWNER_NAME: "Olga",
      SEED_OWNER_PASSWORD: "hunter22hunter22",
    });
    expect(opts).toMatchObject({
      url: "https://localhost",
      name: "Olga",
      password: "hunter22hunter22",
      role: "member",
      insecure: true,
    });
  });

  test("defaults the URL to the local server", () => {
    expect(parseSeedArgs(["--email", "a@example.com"], {})).toMatchObject({ url: DEFAULT_URL });
  });

  test("rejects a missing email, a bad role and a bad URL", () => {
    expect(() => parseSeedArgs([], {})).toThrow(SeedError);
    expect(() => parseSeedArgs(["--email", "a@b.co", "--role", "boss"], {})).toThrow(/--role/);
    expect(() => parseSeedArgs(["--email", "a@b.co", "--url", "nope"], {})).toThrow(/--url/);
  });

  test("--help", () => {
    expect(parseSeedArgs(["--help"], {})).toBe("help");
  });
});

test("generatePassword is long and random", () => {
  const a = generatePassword();
  expect(a.length).toBeGreaterThanOrEqual(24);
  expect(a).not.toBe(generatePassword());
});

describe("seed against a running office", () => {
  let office: ReturnType<typeof startOffice>;
  let base: SeedOptions;
  const userCount = () =>
    (office.db.$client.query("select count(*) as n from users").get() as { n: number }).n;

  beforeAll(() => {
    office = startOffice({ openSignup: false });
    base = {
      url: office.origin,
      email: "owner@example.com",
      name: "Ada",
      role: "member",
      insecure: false,
      json: false,
    };
  });
  afterAll(() => office.stop());

  let ownerPassword = "";

  test("creates the owner with a generated password and a member invite", async () => {
    const result = await seed(base);
    expect(result.ownerCreated).toBe(true);
    expect(result.actor.role).toBe("owner");
    expect(result.generatedPassword).toBeString();
    ownerPassword = result.generatedPassword ?? "";
    expect(result.invite.role).toBe("member");
    expect(result.invite.url.startsWith(`${office.origin}/join/`)).toBe(true);
    const token = result.invite.url.split("/join/")[1] ?? "";
    const peek = await office.request(`/api/invites/${token}`);
    expect(peek.status).toBe(200);
    expect(formatResult(result)).toContain(ownerPassword);
  });

  test("refuses to create a second owner without credentials", async () => {
    await expect(seed({ ...base, email: "other@example.com" })).rejects.toThrow(
      /will not create another owner/,
    );
    expect(userCount()).toBe(1);
  });

  test("with the owner's password, signs in and only mints an invite", async () => {
    const result = await seed({ ...base, password: ownerPassword, role: "admin" });
    expect(result.ownerCreated).toBe(false);
    expect(result.generatedPassword).toBeUndefined();
    expect(result.invite.role).toBe("admin");
    expect(userCount()).toBe(1);
    expect(formatResult(result)).toContain("no owner created");
  });

  test("a wrong password is a clear error", async () => {
    await expect(seed({ ...base, password: "definitely-wrong" })).rejects.toThrow(
      /signing in as owner@example.com failed \(HTTP 401\)/,
    );
  });

  test("an unreachable office is a clear error", async () => {
    await expect(seed({ ...base, url: "http://127.0.0.1:9" })).rejects.toThrow(/cannot reach/);
  });
});
