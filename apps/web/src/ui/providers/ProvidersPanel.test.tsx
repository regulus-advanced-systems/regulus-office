import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { KeyProfileInfo, LoginFlowInfo, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { FakeSocket } from "../terminal/fakeSocket.ts";
import type { TerminalDeps, TerminalHost } from "../terminal/host.ts";
import { usePanelBudget } from "../terminal/panelBudget.ts";
import { createProvidersApi } from "./api.ts";
import { ProvidersPanelHost } from "./ProvidersPanel.tsx";
import { closeProvidersPanel, openProvidersPanel } from "./providersStore.ts";

useDom();

const KEY = "sk-FAKE-web-test-key-0123456789";

const host = (): TerminalHost => ({
  renderer: "dom",
  write() {},
  reset() {},
  setGrid() {},
  fit() {},
  setReadOnly() {},
  focus() {},
  onData: () => () => {},
  dispose() {},
});
const terminalDeps: TerminalDeps = {
  createHost: async () => host(),
  socket: FakeSocket.factory,
  wsBase: () => "ws://office",
};

const signedInAs = (role: UserRole) =>
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Olga", role },
    error: null,
  });

const status = (claude: boolean | null, codex: boolean | null) => ({
  body: {
    providers: [
      { provider: "claude-code", connected: claude, checkedAt: 1 },
      { provider: "codex", connected: codex, checkedAt: 1 },
    ],
  },
});

const flow = (over: Partial<LoginFlowInfo>): LoginFlowInfo => ({
  loginId: "L1",
  provider: "codex",
  kind: "device_code",
  state: "pending",
  expiresAt: 10,
  ...over,
});

const profile = (over: Partial<KeyProfileInfo> = {}): KeyProfileInfo => ({
  id: "p1",
  label: "My Anthropic",
  provider: "claude-code",
  authKind: "api_key",
  preset: "anthropic",
  owner: "me",
  baseUrlHost: null,
  verifiedAt: 1_700_000_000_000,
  createdAt: 1,
  ...over,
});

let mounted: Mounted | null = null;
async function render(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch({
    "GET /api/credential-profiles/manage": { body: { profiles: [] } },
    ...routes,
  });
  const api = createProvidersApi({ fetch: fake.fetch });
  openProvidersPanel();
  mounted = await mount(<ProvidersPanelHost api={api} pollMs={5} terminalDeps={terminalDeps} />);
  await settle();
  return fake;
}

const row = (provider: string) =>
  document.querySelector(`[data-provider="${provider}"]`) as HTMLElement;
const rowButton = (provider: string, label: string) =>
  Array.from(row(provider).querySelectorAll("button")).find((b) => b.textContent === label);

beforeEach(() => {
  FakeSocket.all = [];
  usePanelBudget.setState({ requests: [], granted: new Set() } as never);
});
afterEach(async () => {
  await act(async () => closeProvidersPanel());
  mounted?.unmount();
  mounted = null;
});

describe("subscriptions", () => {
  test("Codex: shows the device code and link, then the connected state", async () => {
    signedInAs("member");
    let polls = 0;
    let connected = false;
    const device = {
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    };
    await render({
      "GET /api/provider-logins": () => status(false, connected),
      "POST /api/provider-logins/codex": {
        status: 201,
        body: flow(device),
      },
      "GET /api/provider-logins/flows/L1": () => {
        polls += 1;
        if (polls < 3) return { body: flow(device) };
        connected = true;
        return { body: flow({ ...device, state: "succeeded" }) };
      },
    });
    expect(row("codex").textContent).toContain("Not connected");
    await click(rowButton("codex", "Connect") as HTMLElement);
    await settle();
    const link = row("codex").querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://auth.openai.com/codex/device");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(row("codex").textContent).toContain("ABCD-1234");
    for (let i = 0; i < 20 && !row("codex").textContent?.includes("Signed in"); i++) {
      await settle();
    }
    expect(row("codex").textContent).toContain("Signed in.");
    expect(row("codex").textContent).toContain("Connected");
  });

  test("Claude: opens the owner's login terminal in control mode; closing cancels", async () => {
    signedInAs("member");
    const claude = flow({
      loginId: "L2",
      provider: "claude-code",
      kind: "pty_paste_code",
      terminalId: "login-u1",
      instructions: "Run claude auth login here.",
    });
    const fake = await render({
      "GET /api/provider-logins": status(false, true),
      "POST /api/provider-logins/claude-code": { status: 201, body: claude },
      "GET /api/provider-logins/flows/L2": { body: claude },
      "POST /api/provider-logins/flows/L2/cancel": { status: 204 },
    });
    await click(rowButton("claude-code", "Connect") as HTMLElement);
    await settle();
    expect(row("claude-code").textContent).toContain("Run claude auth login here.");
    expect(FakeSocket.last().url).toBe("ws://office/ws/term/login-u1?mode=control");
    await act(async () => closeProvidersPanel());
    await settle();
    expect(fake.calls.some((c) => c.path === "/api/provider-logins/flows/L2/cancel")).toBe(true);
  });
});

describe("keys", () => {
  test("adds a key, clears the field, never keeps it in the page", async () => {
    signedInAs("member");
    let list: KeyProfileInfo[] = [];
    const fake = await render({
      "GET /api/provider-logins": status(false, false),
      "GET /api/credential-profiles/manage": () => ({ body: { profiles: list } }),
      "POST /api/credential-profiles": () => {
        list = [profile()];
        return { status: 201, body: { profile: profile(), verification: "ok" } };
      },
    });
    expect(text()).not.toContain("Office-wide key");
    const input = document.querySelector('form[aria-label="Add key"] input[type="password"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no key input");
    await act(async () => {
      input.value = KEY;
    });
    const form = document.querySelector('form[aria-label="Add key"]') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    const post = fake.calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({ preset: "anthropic", apiKey: KEY, owner: "me" });
    expect(input.value).toBe("");
    expect(text()).toContain("Key verified with the provider.");
    expect(text()).toContain("My Anthropic");
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  test("admins get the office-wide option for metered providers only", async () => {
    signedInAs("admin");
    await render({ "GET /api/provider-logins": status(true, true) });
    expect(text()).toContain("Office-wide key");
    const select = document.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "zai";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(text()).not.toContain("Office-wide key");
  });

  test("members cannot delete office keys", async () => {
    signedInAs("member");
    await render({
      "GET /api/provider-logins": status(true, true),
      "GET /api/credential-profiles/manage": {
        body: { profiles: [profile({ id: "o1", owner: "office", label: "Office key" })] },
      },
    });
    expect(text()).toContain("Office key");
    expect(button("Delete")).toBeUndefined();
  });

  test("viewers see nothing to connect", async () => {
    signedInAs("viewer");
    await render({});
    expect(document.querySelector('[data-testid="providers-panel"]')).toBeNull();
  });
});
