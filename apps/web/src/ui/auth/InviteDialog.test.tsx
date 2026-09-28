import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UserRole } from "@regulus/protocol";
import { act, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, mount, useDom } from "../a11y/dom.ts";
import { SettingsForm } from "../settings/SettingsPanel.tsx";
import { AuthProvider } from "./context.tsx";
import { fakeFetch } from "./fakeFetch.ts";
import { INVITE_OVERLAY, InviteDialogHost, invitableRoles } from "./InviteDialog.tsx";
import { button, settle, text } from "./testDom.tsx";

useDom();

const EXPIRES = new Date(Date.now() + 7 * 86_400_000).toISOString();
const signedInAs = (role: UserRole) =>
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });

function renderWith(fetchFn: typeof fetch, node: ReactNode) {
  return mount(
    <AuthProvider fetch={fetchFn}>
      <MemoryRouter>{node}</MemoryRouter>
    </AuthProvider>,
  );
}

describe("invitableRoles", () => {
  test("owners any role, admins all but owner, others none", () => {
    expect(invitableRoles("owner")).toEqual(["owner", "admin", "member", "viewer"]);
    expect(invitableRoles("admin")).toEqual(["admin", "member", "viewer"]);
    expect(invitableRoles("member")).toEqual([]);
    expect(invitableRoles("viewer")).toEqual([]);
    expect(invitableRoles(undefined)).toEqual([]);
  });
});

describe("settings account section and invite dialog", () => {
  beforeEach(() => useUiStore.setState({ overlay: null }));
  afterEach(() => useSessionStore.setState({ status: "unknown", user: null, error: null }));

  test("members see sign-out but no invite entry, and the dialog never renders", async () => {
    signedInAs("member");
    const f = fakeFetch({});
    const m = await renderWith(
      f.fetch,
      <>
        <SettingsForm />
        <InviteDialogHost />
      </>,
    );
    expect(text()).toContain("Signed in as Ante");
    expect(button("Invite someone")).toBeUndefined();
    expect(button("Sign out")).toBeDefined();
    await act(async () => useUiStore.getState().openOverlay(INVITE_OVERLAY));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await m.unmount();
  });

  test("an admin opens the dialog from settings, picks a role and gets a copyable link", async () => {
    signedInAs("admin");
    const f = fakeFetch({
      "POST /api/invites": ({ body }) => ({
        status: 201,
        body: {
          id: "i1",
          token: "tok",
          role: (body as { role: string }).role,
          expiresAt: EXPIRES,
          url: "http://office.test/join/tok",
        },
      }),
    });
    const m = await renderWith(
      f.fetch,
      <>
        <SettingsForm />
        <InviteDialogHost />
      </>,
    );
    await click(button("Invite someone") as HTMLElement);
    expect(useUiStore.getState().overlay).toBe(INVITE_OVERLAY);
    const dialog = document.querySelector("[role=dialog]");
    expect(dialog?.textContent).toContain("Invite someone");
    const select = dialog?.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["admin", "member", "viewer"]);
    expect(select.value).toBe("member");

    await click(button("Create invite link") as HTMLElement);
    await settle();
    expect(f.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/invites",
      body: { role: "member" },
    });
    const link = dialog?.querySelector("input[readonly]") as HTMLInputElement;
    expect(link.value).toBe("http://office.test/join/tok");
    expect(dialog?.textContent).toContain("Works once");
    expect(dialog?.textContent).toContain("in 7 days");

    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void (copied = t) },
    });
    await click(button("Copy") as HTMLElement);
    await settle();
    expect(copied).toBe("http://office.test/join/tok");
    expect(useUiStore.getState().toastQueue.toasts.at(-1)?.message).toBe("Invite link copied.");
    await act(async () => useUiStore.getState().clearToasts());
    await m.unmount();
  });

  test("owners can mint owner invites; server refusals are shown", async () => {
    signedInAs("owner");
    useUiStore.setState({ overlay: INVITE_OVERLAY });
    const f = fakeFetch({ "POST /api/invites": { status: 403, body: { error: "forbidden" } } });
    const m = await renderWith(f.fetch, <InviteDialogHost />);
    const select = document.querySelector("[role=dialog] select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("owner");
    await click(button("Create invite link") as HTMLElement);
    await settle();
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "You do not have permission to do that.",
    );
    await m.unmount();
  });

  test("sign-out calls the server and forgets the user", async () => {
    signedInAs("member");
    const f = fakeFetch({ "POST /api/auth/sign-out": { body: { success: true } } });
    const m = await renderWith(f.fetch, <SettingsForm />);
    await click(button("Sign out") as HTMLElement);
    await settle();
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/auth/sign-out"]);
    expect(useSessionStore.getState()).toMatchObject({ status: "anonymous", user: null });
    await m.unmount();
  });
});
