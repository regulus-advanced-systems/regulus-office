/** The sync routes over a real server (#35): the webhook needs a signature, not a session. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { GITHUB_SYNC_API_PATH, GITHUB_WEBHOOK_PATH } from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { fakeIssue } from "./fake-github-boards.ts";
import { mountGitHubSyncRoutes } from "./sync.ts";
import { type SyncFixture, syncFixture, WEBHOOK_SECRET } from "./sync-fixture.ts";
import { signWebhookBody } from "./webhook-signature.ts";

let office: Office;
let f: SyncFixture;

beforeAll(() => {
  office = startOffice();
  f = syncFixture();
  mountGitHubSyncRoutes(office.server.router, { auth: office.auth, sync: f.sync });
});
afterAll(async () => {
  f.stop();
  await office.stop();
});

const post = (body: string, signature?: string) =>
  fetch(new URL(GITHUB_WEBHOOK_PATH, office.server.url), {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": randomUUID(),
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
  });

test("a signed delivery is accepted without a session; an unsigned one is not", async () => {
  const body = JSON.stringify({
    action: "opened",
    issue: fakeIssue(3, { updated_at: new Date().toISOString() }),
    repository: { name: "hello", full_name: "octo/hello", owner: { login: "octo" } },
  });
  expect((await post(body)).status).toBe(401);
  const res = await post(body, signWebhookBody(WEBHOOK_SECRET, body));
  expect(res.status).toBe(202);
  expect(f.published.get(f.alpha.operationId)?.issues[0]?.number).toBe(3);
});

test("sync status is for owners and admins, and never carries the secret", async () => {
  const owner = await office.signUp("Olga");
  const member = await office.signUp("Mia");
  expect((await office.request(GITHUB_SYNC_API_PATH)).status).toBe(401);
  expect((await office.request(GITHUB_SYNC_API_PATH, { cookie: member.cookie })).status).toBe(403);
  const res = await office.request(GITHUB_SYNC_API_PATH, { cookie: owner.cookie });
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain(WEBHOOK_SECRET);
  expect(JSON.parse(text)).toMatchObject({
    mode: "webhook",
    webhookUrl: "https://office.example.com/api/github/webhook",
    webhookSecretSet: true,
    repos: 2,
  });
});
