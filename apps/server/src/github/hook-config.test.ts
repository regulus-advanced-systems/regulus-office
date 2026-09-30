/** Pointing the office App's webhook at this office (#35), and the manifest's hook. */
import { afterEach, describe, expect, test } from "bun:test";
import { githubConnection } from "../db/schema/index.ts";
import { ensureHookConfig } from "./hook-config.ts";
import { APP_EVENTS, buildManifest } from "./manifest.ts";
import { APP_SLUG, type SyncFixture, syncFixture, WEBHOOK_SECRET } from "./sync-fixture.ts";

const URL_OK = "https://office.example.com/api/github/webhook";
let f: SyncFixture;
afterEach(() => f?.stop());

const ensure = (webhookUrl: string | null = URL_OK) =>
  ensureHookConfig({ connection: f.github.connection, api: f.github.connection.api, webhookUrl });
const patches = () =>
  f.gh.calls.filter((c) => c.method === "PATCH" && c.path === "/app/hook/config");

describe("ensureHookConfig", () => {
  test("a matching config is left alone", async () => {
    f = syncFixture({ hookConfig: { url: URL_OK, content_type: "json", insecure_ssl: "0" } });
    expect(await ensure()).toEqual({ state: "ok", detail: null, slug: APP_SLUG });
    expect(patches()).toHaveLength(0);
  });

  test("another URL is replaced with this office's URL and the stored secret", async () => {
    f = syncFixture({ hookConfig: { url: "https://old.example.com/hook", content_type: "form" } });
    expect((await ensure()).state).toBe("updated");
    expect(patches()[0]?.body).toEqual({
      url: URL_OK,
      content_type: "json",
      insecure_ssl: "0",
      secret: WEBHOOK_SECRET,
    });
  });

  test("an app without a secret gets a new one, stored encrypted only after GitHub took it", async () => {
    f = syncFixture({ webhookSecret: null });
    expect(f.github.connection.webhookSecret()).toBeNull();
    expect((await ensure()).state).toBe("updated");
    const sent = (patches()[0]?.body as { secret: string }).secret;
    expect(sent).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(f.github.connection.webhookSecret()).toBe(sent);
    const row = JSON.stringify(f.db.select().from(githubConnection).all());
    expect(row).not.toContain(sent);
    // The status never carries it.
    expect(JSON.stringify(f.sync.status())).not.toContain(sent);
    expect(f.sync.status().webhookSecretSet).toBe(true);
  });

  test("a GitHub failure is reported and nothing is stored", async () => {
    f = syncFixture({ webhookSecret: null });
    f.gh.state.failAll = true;
    const result = await ensure();
    expect(result.state).toBe("error");
    expect(f.github.connection.webhookSecret()).toBeNull();
  });

  test("no public URL, or no app: nothing to do", async () => {
    f = syncFixture();
    expect((await ensure(null)).state).toBe("not_applicable");
    expect(patches()).toHaveLength(0);
    f.github.connection.store.clear();
    expect((await ensure()).state).toBe("not_applicable");
  });
});

describe("manifest", () => {
  test("a public https office subscribes an active hook to the board and workflow events", () => {
    const manifest = buildManifest("https://office.example.com/") as {
      hook_attributes?: { url: string; active: boolean };
      default_events?: string[];
    };
    expect(manifest.hook_attributes).toEqual({ url: URL_OK, active: true });
    expect(manifest.default_events).toEqual([...APP_EVENTS]);
    for (const e of [
      "issues",
      "pull_request",
      "pull_request_review",
      "check_suite",
      "check_run",
      "push",
    ]) {
      expect(manifest.default_events).toContain(e);
    }
  });

  test("offices GitHub cannot reach get no hook", () => {
    for (const url of [
      "http://office.example.com",
      "https://localhost:4600",
      "https://192.168.1.10",
      "https://10.0.0.5",
      "https://172.20.0.2",
      "https://office.local",
    ]) {
      expect((buildManifest(url) as { hook_attributes?: unknown }).hook_attributes).toBeUndefined();
    }
  });
});
