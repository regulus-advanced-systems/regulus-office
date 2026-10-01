/** Settings → Notifications (#42): my switches, and team webhooks for owners/admins. */
import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationChannelView,
  type UserRole,
} from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { createNotificationsApi } from "../notifications/api.ts";
import { useNotificationsStore } from "../notifications/notificationSync.ts";
import { NotificationsSection } from "./NotificationsSection.tsx";

useDom();

const SLACK_URL = "https://hooks.slack.com/services/T000/B000/fakeSettingsSecret";
const CHANNEL: NotificationChannelView = {
  id: "c1",
  kind: "slack",
  label: "#henchmen",
  chatId: null,
  operationIds: null,
  events: ["needs_input", "done"],
  enabled: true,
  lastDelivery: null,
  createdAt: 1,
};

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  useSessionStore.setState({ status: "unknown", user: null, error: null });
  useNotificationsStore.setState({ prefs: null, attention: [] });
});

async function show(role: UserRole, routes: Parameters<typeof fakeFetch>[0]) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });
  const f = fakeFetch({
    "GET /api/notifications/prefs": { body: DEFAULT_NOTIFICATION_PREFS },
    "PUT /api/notifications/prefs": (call) => ({ body: call.body }),
    ...routes,
  });
  mounted.push(
    await mount(<NotificationsSection api={createNotificationsApi({ fetch: f.fetch })} />),
  );
  await settle();
  return f;
}

const switchNamed = (label: string) =>
  Array.from(document.querySelectorAll('[role="switch"]')).find((el) =>
    el.textContent?.startsWith(label),
  ) as HTMLButtonElement;

describe("notification settings", () => {
  test("a member toggles an event; no team section, no admin switch", async () => {
    const f = await show("member", {});
    expect(text()).toContain("Needs my input");
    expect(text()).not.toContain("Team notifications");
    expect(text()).not.toContain("Anyone's henchman");
    await click(switchNamed("Done"));
    await settle();
    const put = f.calls.find((c) => c.method === "PUT");
    expect((put?.body as typeof DEFAULT_NOTIFICATION_PREFS).desktop.done).toBe(false);
    expect(f.calls.some((c) => c.path.includes("channels"))).toBe(false);
  });

  test("an owner adds a Slack channel; the URL is sent once and cleared", async () => {
    const f = await show("owner", {
      "GET /api/notifications/channels": { body: { channels: [], canStore: true } },
      "POST /api/notifications/channels": { status: 201, body: CHANNEL },
    });
    expect(text()).toContain("Team notifications");
    await click(button("Add channel…") as HTMLButtonElement);
    const labelInput = document.querySelector('input[placeholder="#henchmen"]') as HTMLInputElement;
    const secret = document.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      labelInput.value = "#henchmen";
      secret.value = SLACK_URL;
    });
    await click(button("Add channel") as HTMLButtonElement);
    await settle();
    const post = f.calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({
      kind: "slack",
      label: "#henchmen",
      secret: SLACK_URL,
      operationIds: null,
    });
    expect(secret.value).toBe("");
    expect(document.body.innerHTML).not.toContain("fakeSettingsSecret");
  });

  test("Send test shows the provider's answer as plain words", async () => {
    await show("admin", {
      "GET /api/notifications/channels": { body: { channels: [CHANNEL], canStore: true } },
      "POST /api/notifications/channels/c1/test": { body: { ok: false, code: "http_404" } },
    });
    expect(text()).toContain("Slack: #henchmen");
    await click(button("Send test") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("does not exist (404)");
  });
});
