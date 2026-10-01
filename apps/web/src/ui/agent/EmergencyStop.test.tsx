import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { click, mount, useDom } from "../a11y/dom.ts";
import { AgentPanel } from "./AgentPanel.tsx";
import { useAgentStore } from "./agentStore.ts";
import { bodyText, buttonByText, recorder, seed } from "./testHarness.tsx";

useDom();

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.().catch(() => undefined);
  unmount = undefined;
});

async function openPanel(seedOptions: Parameters<typeof seed>[0]) {
  seed(seedOptions);
  const { sent, wrap } = recorder();
  useAgentStore.getState().openAgentPanel("a1");
  const m = await mount(wrap(<AgentPanel />));
  unmount = m.unmount;
  return sent;
}

describe("emergency stop (D12, #138)", () => {
  test.each(["admin", "owner"] as const)(
    "an office %s stops someone else's henchman after confirming, with a reason",
    async (role) => {
      const sent = await openPanel({ role, userId: "u-boss", henchman: { status: "working" } });
      await click(buttonByText("Emergency stop") as HTMLButtonElement);
      expect(sent).toEqual([]);
      expect(bodyText()).toContain("Stop Mia's henchman?");
      expect(bodyText()).toContain("the branch, worktree and desk stay");

      await click(buttonByText("Cancel") as HTMLButtonElement);
      expect(buttonByText("Stop henchman")).toBeUndefined();
      expect(sent).toEqual([]);

      await click(buttonByText("Emergency stop") as HTMLButtonElement);
      const reason = document.querySelector(
        "form[aria-label='Confirm emergency stop'] input",
      ) as HTMLInputElement;
      await act(async () => {
        reason.value = "  runaway cost ";
      });
      await click(buttonByText("Stop henchman") as HTMLButtonElement);
      expect(sent).toEqual([
        { type: "agent.emergencyStop", payload: { agentId: "a1", reason: "runaway cost" } },
      ]);
      // Nothing else is offered: no prompt, approve, resume, send home or PR.
      expect(document.querySelector("textarea")).toBeNull();
      for (const label of ["Stop", "Interrupt", "Resume", "Send home", "Open PR"]) {
        expect(buttonByText(label)).toBeUndefined();
      }
    },
  );

  test("the reason is optional", async () => {
    const sent = await openPanel({ role: "admin", userId: "u-boss", henchman: { status: "idle" } });
    await click(buttonByText("Emergency stop") as HTMLButtonElement);
    await click(buttonByText("Stop henchman") as HTMLButtonElement);
    expect(sent).toEqual([{ type: "agent.emergencyStop", payload: { agentId: "a1" } }]);
  });

  test("not offered on a stopped henchman, to members or viewers, or on the admin's own henchman", async () => {
    await openPanel({ role: "admin", userId: "u-boss", henchman: { status: "exited" } });
    expect(buttonByText("Emergency stop")).toBeUndefined();
    await unmount?.();
    for (const role of ["member", "viewer"] as const) {
      await openPanel({ role, userId: "u-other", henchman: { status: "working" } });
      expect(buttonByText("Emergency stop")).toBeUndefined();
      await unmount?.();
    }
    // Their own henchman: the ordinary controls, not the emergency lever.
    await openPanel({ role: "admin", henchman: { status: "working" } });
    expect(buttonByText("Emergency stop")).toBeUndefined();
    expect(buttonByText("Stop")).toBeDefined();
  });
});
