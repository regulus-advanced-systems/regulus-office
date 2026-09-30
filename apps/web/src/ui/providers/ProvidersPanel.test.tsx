import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { KeyProfileInfo, LoginFlowInfo, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { FakeHost } from "../terminal/fakeHost.ts";
import { FakeSocket } from "../terminal/fakeSocket.ts";
import type { TerminalDeps } from "../terminal/host.ts";
import { usePanelBudget } from "../terminal/panelBudget.ts";
import { createProvidersApi } from "./api.ts";
import { ProvidersPanelHost } from "./ProvidersPanel.tsx";
import { closeProvidersPanel, openProvidersPanel } from "./providersStore.ts";

useDom();

const KEY = "sk-FAKE-web-test-key-0123456789";

const terminalDeps: TerminalDeps = {
  createHost: async () => new FakeHost(),
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

describe("login terminal (#156)", () => {
  test("shows the CLI's sign-in link with Open and Copy; resizes tmux; expand widens the panel", async () => {
    signedInAs("member");
    localStorage.clear();
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    const claude = flow({
      loginId: "L3",
      provider: "claude-code",
      kind: "pty_paste_code",
      terminalId: "login-u1",
      instructions: "Sign in here.",
    });
    await render({
      "GET /api/provider-logins": status(false, true),
      "POST /api/provider-logins/claude-code": { status: 201, body: claude },
      "GET /api/provider-logins/flows/L3": { body: claude },
      "POST /api/provider-logins/flows/L3/cancel": { status: 204 },
    });
    await click(rowButton("claude-code", "Connect") as HTMLElement);
    await settle();
    const bar = () => document.querySelector('[data-testid="sign-in-link"]') as HTMLElement;
    expect(bar().textContent).toContain("appears here");
    const ws = FakeSocket.last();
    await act(async () => {
      ws.open();
      ws.text({ type: "hello", mode: "control", cols: 160, rows: 45, viewers: 1 });
    });
    // In control the login terminal fills its box and tmux reflows to it.
    expect(ws.sent[0]).toBe(JSON.stringify({ type: "resize", cols: 120, rows: 30 }));
    // The CLI prints its link; it wraps at the terminal width. Only the browser reads it.
    const host = FakeHost.all.at(-1) as FakeHost;
    const url = "https://claude.ai/oauth/authorize?code=true&client_id=FAKE&state=FAKEstate";
    host.cols = 40;
    host.lines = [
      { text: "Use the url below to sign in:", wrapped: false },
      { text: url.slice(0, 40), wrapped: false },
      { text: url.slice(40), wrapped: false },
      { text: "https://evil.example/login", wrapped: false },
    ];
    await act(async () => ws.bytes("output"));
    await act(async () => new Promise((r) => setTimeout(r, 350)));
    const open = bar().querySelector("a") as HTMLAnchorElement;
    expect(open.getAttribute("href")).toBe(url);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    const copy = Array.from(bar().querySelectorAll("button")).find((b) => b.textContent === "Copy");
    await click(copy as HTMLElement);
    await settle();
    expect(written).toEqual([url]);
    expect(bar().textContent).toContain("Copied");
    // Nothing from the terminal went to the office server.
    const frames = ws.sent.filter((f) => typeof f === "string");
    expect(frames.every((f) => !String(f).includes("claude.ai"))).toBe(true);

    const frame = () => document.querySelector(".rg-modal") as HTMLElement;
    expect(frame().style.getPropertyValue("--rg-modal-width")).toBe("760px");
    await click(document.querySelector('[data-testid="terminal-expand"]') as HTMLElement);
    expect(Number.parseInt(frame().style.getPropertyValue("--rg-modal-width"), 10)).toBeGreaterThan(
      900,
    );
    expect(localStorage.getItem("regulus.terminal.expanded.u1")).toBe("1");
    localStorage.clear();
  });
});

describe("a sign-in that cannot start (#151)", () => {
  test("shows the classified reason and Try again starts it again", async () => {
    signedInAs("member");
    let attempts = 0;
    const device = { verificationUrl: "https://auth.openai.com/codex/device", userCode: "WXYZ-9" };
    const fake = await render({
      "GET /api/provider-logins": status(null, null),
      "POST /api/provider-logins/codex": () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            status: 502,
            body: {
              error: "login_unavailable",
              cause: "runner_api",
              reason:
                "Docker Engine: POST <path>: 500 RWLayer of container [redacted] is unexpectedly nil",
            },
          };
        }
        return { status: 201, body: flow(device) };
      },
      "GET /api/provider-logins/flows/L1": { body: flow(device) },
    });
    await click(rowButton("codex", "Connect") as HTMLElement);
    await settle();
    const shown = row("codex").textContent ?? "";
    expect(shown).toContain("Your runner could not start");
    expect(shown).toContain("RWLayer of container [redacted] is unexpectedly nil");
    expect(shown).not.toContain("Is the CLI installed");
    await click(rowButton("codex", "Try again") as HTMLElement);
    await settle();
    expect(attempts).toBe(2);
    expect(row("codex").textContent).toContain("WXYZ-9");
    expect(row("codex").querySelector('[data-testid="login-start-error"]')).toBeNull();
    expect(fake.calls.filter((c) => c.path === "/api/provider-logins/codex")).toHaveLength(2);
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
