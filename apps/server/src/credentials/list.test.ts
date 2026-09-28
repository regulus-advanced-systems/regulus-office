/** `GET /api/credential-profiles`: own profiles + office keys, never another human's, never a secret. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CREDENTIAL_PROFILES_API_PATH, CredentialProfileListResponse } from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { credentialProfiles } from "../db/schema/index.ts";
import { mountCredentialProfileRoutes } from "./list.ts";

let office: Office;
let olga: { id: string; cookie: string };
let mia: { id: string; cookie: string };

const SECRET_MARK = "sk-FAKE-never-in-a-response";
const BASE_URL_MARK = "https://plan.example/never-in-a-response";

beforeAll(async () => {
  office = startOffice();
  mountCredentialProfileRoutes(office.server.router, { auth: office.auth, db: office.db });
  olga = await office.signUp("Olga");
  mia = await office.signUp("Mia");
  const add = (row: typeof credentialProfiles.$inferInsert) =>
    office.db.insert(credentialProfiles).values(row).run();
  const at = (s: number) => new Date(1_700_000_000_000 + s * 1000);
  add({
    id: "olga-claude-key",
    userId: olga.id,
    provider: "claude-code",
    label: "Olga's Anthropic key",
    authKind: "api_key",
    encryptedSecret: `v1.${SECRET_MARK}`,
    createdAt: at(1),
  });
  add({
    id: "olga-codex-login",
    userId: olga.id,
    provider: "codex",
    label: "Olga's ChatGPT",
    authKind: "cli_login",
    createdAt: at(2),
  });
  add({
    id: "mia-claude-plan",
    userId: mia.id,
    provider: "claude-code",
    label: "Mia's Z.AI plan",
    authKind: "base_url_key",
    encryptedSecret: `v1.${SECRET_MARK}`,
    baseUrl: BASE_URL_MARK,
    createdAt: at(3),
  });
  // Two office keys for Claude: the older one is what `office:claude-code` resolves to.
  add({
    id: "office-claude-old",
    userId: null,
    provider: "claude-code",
    label: "Office Anthropic key",
    authKind: "api_key",
    encryptedSecret: `v1.${SECRET_MARK}`,
    createdAt: at(4),
  });
  add({
    id: "office-claude-new",
    userId: null,
    provider: "claude-code",
    label: "Newer office key",
    authKind: "api_key",
    encryptedSecret: `v1.${SECRET_MARK}`,
    createdAt: at(5),
  });
});

afterAll(async () => {
  await office.stop();
});

const list = (cookie?: string, query = "") =>
  office.request(`${CREDENTIAL_PROFILES_API_PATH}${query}`, { cookie });

describe("credential profile list", () => {
  test("anonymous callers get 401", async () => {
    expect((await list()).status).toBe(401);
  });

  test("own profiles and office keys only, office keys as office:<provider>", async () => {
    const res = await list(olga.cookie);
    expect(res.status).toBe(200);
    const body = CredentialProfileListResponse.parse(await res.json());
    expect(body.profiles).toEqual([
      {
        id: "olga-claude-key",
        label: "Olga's Anthropic key",
        provider: "claude-code",
        authKind: "api_key",
        owner: "me",
      },
      {
        id: "olga-codex-login",
        label: "Olga's ChatGPT",
        provider: "codex",
        authKind: "cli_login",
        owner: "me",
      },
      {
        id: "office:claude-code",
        label: "Office Anthropic key",
        provider: "claude-code",
        authKind: "api_key",
        owner: "office",
      },
    ]);
  });

  test("another human's profiles never show up", async () => {
    const body = CredentialProfileListResponse.parse(await (await list(mia.cookie)).json());
    const ids = body.profiles.map((p) => p.id);
    expect(ids).toEqual(["mia-claude-plan", "office:claude-code"]);
    expect(ids).not.toContain("olga-claude-key");
  });

  test("filters by provider and rejects unknown providers", async () => {
    const codex = CredentialProfileListResponse.parse(
      await (await list(olga.cookie, "?provider=codex")).json(),
    );
    expect(codex.profiles.map((p) => p.id)).toEqual(["olga-codex-login"]);
    const claude = CredentialProfileListResponse.parse(
      await (await list(olga.cookie, "?provider=claude-code")).json(),
    );
    expect(claude.profiles.map((p) => p.id)).toEqual(["olga-claude-key", "office:claude-code"]);
    expect((await list(olga.cookie, "?provider=chatgpt")).status).toBe(400);
  });

  test("responses carry no secrets, envelopes or base URLs", async () => {
    for (const cookie of [olga.cookie, mia.cookie]) {
      const res = await list(cookie);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(text).not.toContain(SECRET_MARK);
      expect(text).not.toContain(BASE_URL_MARK);
      expect(text).not.toContain("encryptedSecret");
      expect(text).not.toContain("baseUrl");
    }
  });
});
