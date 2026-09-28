import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { click, mount, press, useDom } from "../a11y/dom.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { AgentPanel } from "./AgentPanel.tsx";
import { useAgentStore } from "./agentStore.ts";
import { PermissionDialog } from "./PermissionDialog.tsx";
import { PullRequestDialog } from "./PullRequestDialog.tsx";
import { SendHomeDialog } from "./SendHomeDialog.tsx";
import { bodyText, buttonByText, recorder, seed } from "./testHarness.tsx";

useDom();

const request = {
  requestId: "p1",
  toolName: "Bash",
  description: "Bash: rm -rf node_modules && bun install",
  options: ["allow_once" as const, "allow_always" as const, "reject" as const],
  requestedAt: Date.now(),
  expiresAt: Date.now() + 90_000,
};

/** The text fields are uncontrolled: setting the DOM value is what typing does. */
async function setInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    el.value = value;
  });
}

let mounted: { unmount: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const m of mounted) await m.unmount().catch(() => undefined);
  mounted = [];
});
const track = <T extends { unmount: () => Promise<void> }>(m: T): T => {
  mounted.push(m);
  return m;
};

describe("AgentPanel", () => {
  test("the robot's owner sees status, task, model, owner and every control", async () => {
    seed({ robot: { status: "working" } });
    const { sent, wrap } = recorder();
    useAgentStore.getState().openAgentPanel("a1");
    const m = track(await mount(wrap(<AgentPanel />)));
    const text = bodyText();
    for (const s of ["Working", "Fix #8", "Claude Code · claude-sonnet-4-5 (high)", "Mia"]) {
      expect(text).toContain(s);
    }
    await click(buttonByText("Open terminal") as HTMLButtonElement);
    expect(useTerminalModal.getState().agentId).toBe("a1");

    const box = document.querySelector("textarea") as HTMLTextAreaElement;
    await setInput(box, "  add tests  ");
    await act(async () => {
      document
        .querySelector("form[aria-label='Prompt the robot']")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(box.value).toBe("");
    await click(buttonByText("Interrupt") as HTMLButtonElement);
    await click(buttonByText("Stop") as HTMLButtonElement);
    expect(buttonByText("Resume")).toBeUndefined();
    expect(sent).toEqual([
      { type: "agent.prompt", payload: { agentId: "a1", text: "add tests" } },
      { type: "agent.interrupt", payload: { agentId: "a1" } },
      { type: "agent.stop", payload: { agentId: "a1" } },
    ]);
    await click(buttonByText("Send home") as HTMLButtonElement);
    expect(useAgentStore.getState().dialog).toBe("sendHome");
    await act(async () => useTerminalModal.getState().closeTerminal());
    await m.unmount();
  });

  test("a stopped robot offers resume and no prompt", async () => {
    seed({ robot: { status: "exited" } });
    const { sent, wrap } = recorder();
    useAgentStore.getState().openAgentPanel("a1");
    const m = track(await mount(wrap(<AgentPanel />)));
    expect((document.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
    expect(buttonByText("Stop")).toBeUndefined();
    await click(buttonByText("Resume") as HTMLButtonElement);
    expect(sent).toEqual([{ type: "agent.resume", payload: { agentId: "a1" } }]);
    await m.unmount();
  });

  test.each([
    ["another member", "member", "u-other"],
    ["a viewer who owns it", "viewer", "u-owner"],
  ] as const)("%s only watches", async (_label, role, userId) => {
    seed({ role, userId });
    const { wrap } = recorder();
    useAgentStore.getState().openAgentPanel("a1");
    const m = track(await mount(wrap(<AgentPanel />)));
    expect(bodyText()).toContain("Only Mia or an admin can control this robot.");
    expect(document.querySelector("textarea")).toBeNull();
    expect(buttonByText("Stop")).toBeUndefined();
    expect(buttonByText("Open PR")).toBeUndefined();
    expect(buttonByText("Watch terminal")).toBeDefined();
    await m.unmount();
  });

  test("an office admin controls someone else's robot", async () => {
    seed({ role: "admin", userId: "u-admin" });
    const { wrap } = recorder();
    useAgentStore.getState().openAgentPanel("a1");
    const m = track(await mount(wrap(<AgentPanel />)));
    expect(buttonByText("Stop")).toBeDefined();
    await m.unmount();
  });

  test("the raised hand opens the permission prompt", async () => {
    seed({ robot: { status: "waiting_permission", handRaised: true } });
    const { wrap } = recorder();
    useAgentStore.getState().setPermissions("a1", [request]);
    useAgentStore.getState().closePermissionPrompt();
    useAgentStore.getState().openAgentPanel("a1");
    const m = track(await mount(wrap(<AgentPanel />)));
    await click(buttonByText("Review request") as HTMLButtonElement);
    expect(useAgentStore.getState().permissionAgentId).toBe("a1");
    await m.unmount();
  });
});

describe("PermissionDialog", () => {
  test("pops up with exactly what would run and answers with the chosen option", async () => {
    seed({ robot: { status: "waiting_permission", handRaised: true } });
    const { sent, wrap } = recorder();
    const m = track(await mount(wrap(<PermissionDialog />)));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await act(async () => useAgentStore.getState().setPermissions("a1", [request]));
    const dialog = document.querySelector("[role=dialog]") as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("pre")?.textContent).toBe(request.description);
    expect(dialog.textContent).toContain("Bash");
    const labels = Array.from(dialog.querySelectorAll(".rg-modal__footer button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Allow once", "Allow always", "Reject"]);
    await click(buttonByText("Allow always") as HTMLButtonElement);
    expect(sent).toEqual([
      {
        type: "agent.approve",
        payload: { agentId: "a1", requestId: "p1", decision: "allow_always" },
      },
    ]);
    expect(buttonByText("Reject")?.disabled).toBe(true);
    // The server clears the request once answered.
    await act(async () => useAgentStore.getState().setPermissions("a1", []));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await m.unmount();
  });

  test("only offered options are shown; Escape closes without answering", async () => {
    seed({});
    const { sent, wrap } = recorder();
    const m = track(await mount(wrap(<PermissionDialog />)));
    await act(async () =>
      useAgentStore
        .getState()
        .setPermissions("a1", [{ ...request, options: ["allow_once", "reject"] }]),
    );
    expect(buttonByText("Allow always")).toBeUndefined();
    await press(document.querySelector("[role=dialog]") as HTMLElement, "Escape");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(sent).toEqual([]);
    await m.unmount();
  });
});

describe("SendHomeDialog", () => {
  test("checks the worktree, warns about uncommitted files and sends the branch choice", async () => {
    seed({});
    const { sent, wrap } = recorder();
    useAgentStore.getState().openAgentPanel("a1");
    useAgentStore.getState().openDialog("sendHome");
    const m = track(await mount(wrap(<SendHomeDialog />)));
    expect(sent).toEqual([{ type: "agent.worktree", payload: { agentId: "a1" } }]);
    expect(bodyText()).toContain("Checking for uncommitted changes");
    await act(async () =>
      useAgentStore.getState().succeeded({
        type: "agent.worktree",
        agentId: "a1",
        worktree: { branch: "office/fix-8", uncommitted: ["src/a.ts", "notes.md"] },
      }),
    );
    expect(bodyText()).toContain("2 uncommitted changes will be lost");
    expect(bodyText()).toContain("src/a.ts");
    const radios = document.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios[0]?.checked).toBe(true);
    await click(radios[1] as HTMLInputElement);
    await click(buttonByText("Send home") as HTMLButtonElement);
    expect(sent.at(-1)).toEqual({
      type: "agent.sendHome",
      payload: { agentId: "a1", keepBranch: false },
    });
    await m.unmount();
  });
});

describe("PullRequestDialog", () => {
  test("prefills from the task, lists uncommitted files when refused, links the PR", async () => {
    seed({ robot: { taskTitle: "Fix #8", taskSummary: "Wire types", issueNumber: 8 } });
    const { sent, wrap } = recorder();
    useAgentStore.getState().openAgentPanel("a1");
    useAgentStore.getState().openDialog("pr");
    const m = track(await mount(wrap(<PullRequestDialog />)));
    const title = document.querySelector("input.rg-input") as HTMLInputElement;
    const body = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(title.value).toBe("Fix #8");
    expect(body.value).toBe("Wire types\n\nCloses #8");
    expect(document.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("true");
    await click(document.querySelector("[role=switch]") as HTMLElement);
    await setInput(title, "Fix the wire types");
    await click(buttonByText("Open PR") as HTMLButtonElement);
    expect(sent).toEqual([
      {
        type: "agent.pr",
        payload: {
          agentId: "a1",
          draft: false,
          title: "Fix the wire types",
          body: "Wire types\n\nCloses #8",
        },
      },
    ]);
    await act(async () =>
      useAgentStore.getState().refused("a1", {
        type: "agent.pr",
        reason: "the worktree has 1 uncommitted change(s); ask the agent to commit first",
        files: ["src/dirty.ts"],
      }),
    );
    expect(bodyText()).toContain("ask the agent to commit first");
    expect(document.querySelector("[aria-label='Uncommitted changes']")?.textContent).toContain(
      "src/dirty.ts",
    );

    await click(buttonByText("Open PR") as HTMLButtonElement);
    await act(async () =>
      useAgentStore.getState().succeeded({
        type: "agent.pr",
        agentId: "a1",
        pr: {
          number: 42,
          url: "https://github.com/octo/hello/pull/42",
          draft: false,
          created: true,
          branch: "office/fix-8",
        },
      }),
    );
    const link = document.querySelector("a") as HTMLAnchorElement;
    expect(link.href).toBe("https://github.com/octo/hello/pull/42");
    expect(link.textContent).toBe("#42");
    expect(link.rel).toContain("noopener");
    await m.unmount();
  });
});
