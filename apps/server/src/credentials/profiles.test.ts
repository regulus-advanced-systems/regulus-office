/**
 * Key profiles over REST (SPEC §8 rules 2 and 3, D2): verified against a fake
 * provider, encrypted with the AgentManager's context (decrypted back through
 * `CredentialResolver`, the spawn path), never echoed in responses, logs or
 * audit metadata; office keys admin-only and metered-only; verify rate limited.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CREDENTIAL_PROFILE_WRITE_PATH, KeyProfileWriteResponse } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { CredentialResolver } from "../agents/manager/credentials.ts";
import { credentialProfiles } from "../db/schema/index.ts";
import {
  BAD_KEY,
  BODY_MARK,
  type CredentialOffice,
  GOOD_KEY,
  OTHER_GOOD_KEY,
  SLOW_KEY,
  startCredentialOffice,
  startFakeProvider,
} from "./testing/helpers.ts";

type User = { id: string; cookie: string };

let provider: ReturnType<typeof startFakeProvider>;
let office: CredentialOffice;
let owner: User;
let admin: User;
let olga: User;
let mia: User;
let viewer: User;

const BASE = CREDENTIAL_PROFILE_WRITE_PATH;
const ALL_KEYS = [GOOD_KEY, OTHER_GOOD_KEY, BAD_KEY, SLOW_KEY];

beforeAll(async () => {
  provider = startFakeProvider();
  office = startCredentialOffice({ providerUrl: provider.url });
  owner = await office.user("Owner"); // first sign-up becomes the office owner
  admin = await office.user("Ada", "admin");
  olga = await office.user("Olga");
  mia = await office.user("Mia");
  viewer = await office.user("Vic", "viewer");
});

afterAll(async () => {
  await office.stop();
  provider.stop();
});

const create = (cookie: string, body: Record<string, unknown>) =>
  office.send("POST", BASE, cookie, body);

async function created(res: Response) {
  expect(res.status).toBe(201);
  return KeyProfileWriteResponse.parse(await res.json());
}

describe("personal key profiles", () => {
  test("a verified Anthropic key decrypts through the spawn path", async () => {
    const body = await created(
      await create(olga.cookie, { preset: "anthropic", label: "Mine", apiKey: GOOD_KEY }),
    );
    expect(body.verification).toBe("ok");
    expect(body.profile).toMatchObject({
      provider: "claude-code",
      authKind: "api_key",
      preset: "anthropic",
      owner: "me",
    });
    expect(body.profile.verifiedAt).toBeNumber();
    const call = provider.calls.at(-1);
    expect(call?.path).toBe("/anthropic/models");
    expect(call?.headers["x-api-key"]).toBe(GOOD_KEY);
    expect(call?.headers["anthropic-version"]).toBe("2023-06-01");

    const resolver = new CredentialResolver(office.db, office.keyring);
    const resolved = resolver.resolve(olga.id, "claude-code", body.profile.id);
    expect(resolved.credential.kind).toBe("api_key");
    if (resolved.credential.kind !== "api_key") throw new Error("unreachable");
    expect(resolved.credential.apiKey.reveal()).toBe(GOOD_KEY);
    expect(resolved.credential.attributedTo).toBe("user");
    // Another human cannot spawn with it.
    expect(() => resolver.resolve(mia.id, "claude-code", body.profile.id)).toThrow();
  });

  test("a DeepSeek plan key stores the preset base URL and model overrides", async () => {
    const body = await created(
      await create(olga.cookie, { preset: "deepseek", label: "DS", apiKey: GOOD_KEY }),
    );
    expect(provider.calls.at(-1)?.headers.authorization).toBe(`Bearer ${GOOD_KEY}`);
    expect(body.profile.baseUrlHost).toBe("api.deepseek.com");
    const resolved = new CredentialResolver(office.db, office.keyring).resolve(
      olga.id,
      "claude-code",
      body.profile.id,
    );
    if (resolved.credential.kind !== "base_url_key") throw new Error("expected base_url_key");
    expect(resolved.credential.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(resolved.credential.modelOverrides?.opus).toBe("deepseek-v4-pro");
    expect(resolved.credential.apiKey.reveal()).toBe(GOOD_KEY);
  });

  test("a rejected key is not stored", async () => {
    const before = office.db.select().from(credentialProfiles).all().length;
    const res = await create(olga.cookie, { preset: "openai", label: "x", apiKey: BAD_KEY });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("key_rejected");
    expect(office.db.select().from(credentialProfiles).all().length).toBe(before);
  });

  test("an unreachable provider stores the key unverified", async () => {
    const body = await created(
      await create(olga.cookie, { preset: "gemini", label: "slow", apiKey: SLOW_KEY }),
    );
    expect(body.verification).toBe("unreachable");
    expect(body.profile.verifiedAt).toBeNull();
    expect(provider.calls.at(-1)?.headers["x-goog-api-key"]).toBe(SLOW_KEY);
  });

  test("custom endpoints need an https base URL and are never called", async () => {
    const calls = provider.calls.length;
    const missing = await create(olga.cookie, {
      preset: "custom-claude",
      label: "gw",
      apiKey: GOOD_KEY,
    });
    expect(missing.status).toBe(400);
    const plain = await create(olga.cookie, {
      preset: "custom-claude",
      label: "gw",
      apiKey: GOOD_KEY,
      baseUrl: "http://gateway.example/anthropic",
    });
    expect(plain.status).toBe(400);
    const body = await created(
      await create(olga.cookie, {
        preset: "custom-claude",
        label: "gw",
        apiKey: GOOD_KEY,
        baseUrl: "https://gateway.example/anthropic",
      }),
    );
    expect(body.verification).toBe("unsupported");
    expect(body.profile.baseUrlHost).toBe("gateway.example");
    expect(provider.calls.length).toBe(calls);
    // A preset's base URL cannot be swapped out.
    const swapped = await create(olga.cookie, {
      preset: "zai",
      label: "z",
      apiKey: GOOD_KEY,
      baseUrl: "https://evil.example",
    });
    expect(swapped.status).toBe(400);
  });

  test("re-verify replaces the key; a rejected one leaves it alone", async () => {
    const body = await created(
      await create(mia.cookie, { preset: "kimi", label: "K", apiKey: GOOD_KEY }),
    );
    const path = `${BASE}/${body.profile.id}/verify`;
    expect((await office.send("POST", path, mia.cookie, { apiKey: BAD_KEY })).status).toBe(422);
    const resolver = new CredentialResolver(office.db, office.keyring);
    const keyOf = () => {
      const r = resolver.resolve(mia.id, "claude-code", body.profile.id);
      return r.credential.kind === "cli_login" ? null : r.credential.apiKey.reveal();
    };
    expect(keyOf()).toBe(GOOD_KEY);
    const ok = await office.send("POST", path, mia.cookie, { apiKey: OTHER_GOOD_KEY });
    expect(ok.status).toBe(200);
    expect(KeyProfileWriteResponse.parse(await ok.json()).verification).toBe("ok");
    expect(keyOf()).toBe(OTHER_GOOD_KEY);
    // Someone else's profile does not exist for Olga.
    expect((await office.send("POST", path, olga.cookie, { apiKey: GOOD_KEY })).status).toBe(404);
  });

  test("delete: own profiles only", async () => {
    const body = await created(
      await create(mia.cookie, { preset: "openai", label: "del", apiKey: GOOD_KEY }),
    );
    const path = `${BASE}/${body.profile.id}`;
    expect((await office.send("DELETE", path, olga.cookie)).status).toBe(404);
    expect((await office.send("DELETE", path, admin.cookie)).status).toBe(404);
    expect((await office.send("DELETE", path, mia.cookie)).status).toBe(204);
    expect(
      office.db
        .select()
        .from(credentialProfiles)
        .where(eq(credentialProfiles.id, body.profile.id))
        .get(),
    ).toBeUndefined();
  });

  test("viewers, anonymous and cross-origin callers are refused", async () => {
    const body = { preset: "anthropic", label: "v", apiKey: GOOD_KEY };
    expect((await create(viewer.cookie, body)).status).toBe(403);
    expect((await office.send("POST", BASE, "", body)).status).toBe(401);
    const cross = await office.request(BASE, {
      method: "POST",
      cookie: olga.cookie,
      body: JSON.stringify(body),
      headers: { origin: "https://evil.example" },
    });
    expect(cross.status).toBe(403);
  });

  test("invalid bodies name fields only, never echo the key", async () => {
    const res = await create(olga.cookie, { preset: "anthropic", label: "", apiKey: GOOD_KEY });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("label");
    expect(text).not.toContain(GOOD_KEY);
  });
});

describe("office keys (D2)", () => {
  test("admins add metered keys; they resolve as office:<provider>, attributed to office", async () => {
    const body = await created(
      await create(admin.cookie, {
        preset: "openai",
        label: "Office OpenAI",
        apiKey: GOOD_KEY,
        owner: "office",
      }),
    );
    expect(body.profile.owner).toBe("office");
    const row = office.db
      .select()
      .from(credentialProfiles)
      .where(eq(credentialProfiles.id, body.profile.id))
      .get();
    expect(row?.userId).toBeNull();
    const resolved = new CredentialResolver(office.db, office.keyring).resolve(
      mia.id,
      "codex",
      "office:codex",
    );
    if (resolved.credential.kind !== "api_key") throw new Error("expected api_key");
    expect(resolved.credential.apiKey.reveal()).toBe(GOOD_KEY);
    expect(resolved.credential.attributedTo).toBe("office");
  });

  test("members cannot add office keys; nobody can share a subscription plan", async () => {
    const office_ = { label: "o", apiKey: GOOD_KEY, owner: "office" };
    expect((await create(olga.cookie, { preset: "anthropic", ...office_ })).status).toBe(403);
    for (const preset of ["zai", "kimi", "custom-claude"]) {
      const res = await create(owner.cookie, {
        preset,
        ...office_,
        ...(preset.startsWith("custom") ? { baseUrl: "https://gw.example" } : {}),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("office_key_not_metered");
    }
  });

  test("members see office keys but cannot delete them; admins can", async () => {
    const body = await created(
      await create(owner.cookie, {
        preset: "deepseek",
        label: "Office DS",
        apiKey: GOOD_KEY,
        owner: "office",
      }),
    );
    const list = await office.send("GET", `${BASE}/manage`, olga.cookie);
    const { profiles } = (await list.json()) as { profiles: { id: string; owner: string }[] };
    expect(profiles.find((p) => p.id === body.profile.id)?.owner).toBe("office");
    expect(profiles.every((p) => p.owner === "office" || p.id)).toBe(true);
    // Olga never sees Mia's profiles.
    const miaIds = office.db
      .select()
      .from(credentialProfiles)
      .where(eq(credentialProfiles.userId, mia.id))
      .all()
      .map((r) => r.id);
    expect(profiles.some((p) => miaIds.includes(p.id))).toBe(false);
    const path = `${BASE}/${body.profile.id}`;
    expect((await office.send("DELETE", path, olga.cookie)).status).toBe(404);
    expect((await office.send("DELETE", path, admin.cookie)).status).toBe(204);
  });
});

describe("secrecy", () => {
  test("no key or provider response body in responses, logs, audit or stored rows", async () => {
    const list = await (await office.send("GET", `${BASE}/manage`, olga.cookie)).text();
    const logs = office.lines.join("\n");
    const audit = JSON.stringify(office.audit());
    const rows = JSON.stringify(office.db.select().from(credentialProfiles).all());
    for (const haystack of [list, logs, audit, rows]) {
      for (const key of ALL_KEYS) expect(haystack).not.toContain(key);
      expect(haystack).not.toContain(BODY_MARK);
    }
    expect(list).not.toContain("encryptedSecret");
    expect(logs).toContain("credential profile created");
    const actions = office.audit().map((a) => a.action);
    expect(actions).toContain("credential_profile.create");
    expect(actions).toContain("credential_profile.verify");
    expect(actions).toContain("credential_profile.delete");
  });
});

describe("limits and configuration", () => {
  test("verify calls are rate limited per user", async () => {
    const limited = startCredentialOffice({ providerUrl: provider.url, limits: "default" });
    try {
      const u = await limited.user("Rita");
      const other = await limited.user("Sam");
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await limited.send("POST", BASE, u.cookie, {
          preset: "anthropic",
          label: `r${i}`,
          apiKey: GOOD_KEY,
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
      expect(statuses.at(-1)).toBe(429);
      // Per user: someone else is not affected.
      const res = await limited.send("POST", BASE, other.cookie, {
        preset: "anthropic",
        label: "s",
        apiKey: GOOD_KEY,
      });
      expect(res.status).toBe(201);
    } finally {
      await limited.stop();
    }
  });

  test("without OFFICE_MASTER_KEY nothing is stored", async () => {
    const bare = startCredentialOffice({ keyring: null, providerUrl: provider.url });
    try {
      const u = await bare.user("Nora");
      const res = await bare.send("POST", BASE, u.cookie, {
        preset: "anthropic",
        label: "n",
        apiKey: GOOD_KEY,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("master_key_required");
    } finally {
      await bare.stop();
    }
  });
});
