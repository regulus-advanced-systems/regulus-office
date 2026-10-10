/**
 * Settings → Watchdog (#253): the report for everyone, a proposed fix a person
 * agrees to or declines, and the pushes that become toasts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { WatchdogFindingView } from "@regulus/protocol";
import { act } from "react";
import { click, useDom } from "../a11y/dom.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { cleanup, finding, report, show } from "./testKit.tsx";
import { reportToast, startWatchdogReports } from "./WatchdogHost.tsx";

useDom();
afterEach(cleanup);

describe("the report", () => {
  test("a member reads the findings and the rounds, and gets no setup and no round button", async () => {
    const f = await show("member", { "GET /api/watchdog": { body: report() } });
    expect(text()).toContain("Cerberus is on duty. Next round in about 30 min.");
    expect(text()).toContain("Orders handler reads id of undefined");
    expect(text()).toContain("Fix proposed");
    expect(text()).toContain("A missing null check in the orders route.");
    expect(text()).toContain("Its verdict is a comment on the Sentry issue.");
    // The Sentry issue is a link out; nothing here resolves it.
    const link = document.querySelector('a[href*="sentry.io"]');
    expect(link?.textContent).toBe("Sentry WEB-1A");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(text()).not.toContain("Resolve issue");
    // A failed round is shown with why.
    expect(text()).toContain("Did not finish: 1 of its 2 parts did not finish.");
    // The summaries of the rooms this person may see, and what could not be read there.
    expect(text()).toContain("api has two faults.");
    expect(text()).toContain("Not read: prod-2: the connection was refused");
    // The dismissed one is behind a button.
    expect(text()).not.toContain("Payments upstream timing out");
    await click(button("Show 1 dismissed") as HTMLButtonElement);
    expect(text()).toContain("Payments upstream timing out");
    expect(button("Do a round now")).toBeUndefined();
    expect(text()).not.toContain("Hosts");
    expect(f.calls.map((c) => c.path)).toEqual(["/api/watchdog"]);
  });

  test("a person who may decide opens the draft pull request or declines", async () => {
    let state: WatchdogFindingView["fix"]["state"] = "awaiting_approval";
    const f = await show("member", {
      "GET /api/watchdog": () => ({
        body: report({
          findings: [
            finding({
              fix: {
                state,
                summary: "Guard req.user.",
                auto: false,
                canDecide: state === "awaiting_approval",
              },
            }),
          ],
        }),
      }),
      "POST /api/watchdog/findings/f1/fix": (call) => {
        state = (call.body as { decision: string }).decision === "open" ? "queued" : "declined";
        return { body: finding({ fix: { state, summary: "", auto: false, canDecide: false } }) };
      },
    });
    expect(text()).toContain("It becomes a draft pull request once someone agrees.");
    await click(button("Open a draft pull request") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({ decision: "open" });
    expect(text()).toContain("A henchman is writing the fix.");
    expect(button("Open a draft pull request")).toBeUndefined();
  });

  test("someone who may not decide sees the proposal without the buttons; a refusal is shown", async () => {
    await show("member", {
      "GET /api/watchdog": {
        body: report({
          findings: [
            finding({
              fix: {
                state: "pr_open",
                summary: "",
                auto: true,
                prNumber: 41,
                prUrl: "https://github.test/octo/hello/pull/41",
                canDecide: false,
              },
            }),
          ],
        }),
      },
    });
    expect(button("Open a draft pull request")).toBeUndefined();
    expect(document.querySelector('a[href$="/pull/41"]')?.textContent).toBe(
      "Draft pull request #41",
    );
  });

  test("the list reloads when the office says a round ended with findings for this person", async () => {
    let n = 0;
    const f = await show("member", {
      "GET /api/watchdog": () => {
        n += 1;
        return { body: report({ findings: n === 1 ? [] : [finding({})] }) };
      },
    });
    expect(text()).toContain("Nothing that needs you");
    await act(async () => f.nudges.get("watchdog.report")?.());
    await settle();
    expect(text()).toContain("Orders handler reads id of undefined");
  });

  test("the push becomes a toast with a count and a way in; anything else is ignored", () => {
    const toasts: Array<{ title?: string; message: string }> = [];
    let opened = 0;
    const listeners = new Map<string, (payload: unknown) => void>();
    const off = startWatchdogReports({
      onMessage: (type, fn) => {
        listeners.set(type, fn);
        return () => void listeners.delete(type);
      },
      toast: (t) => void toasts.push(t),
      open: () => {
        opened += 1;
      },
    });
    expect([...listeners.keys()].sort()).toEqual(["watchdog.alert", "watchdog.report"]);
    const report = listeners.get("watchdog.report");
    report?.({ roundId: "r1", findings: 2, agentName: "Cerberus" });
    report?.({ roundId: "r1", findings: 0, agentName: "Cerberus" });
    report?.("nonsense");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      title: "Cerberus is back from its round",
      message: "2 findings for you to look at.",
    });
    // A watched host that shows another key: said to the people who run the office.
    const alert = listeners.get("watchdog.alert");
    alert?.({ kind: "host_key_changed", hostId: "h1", hostLabel: "prod-1" });
    alert?.({ kind: "something_else", hostId: "h1", hostLabel: "prod-1" });
    expect(toasts).toHaveLength(2);
    expect(toasts[1]).toMatchObject({
      title: "A watched host shows another key",
      message: "prod-1 is not read until an admin looks at it.",
    });
    reportToast({ roundId: "r", findings: 1, agentName: "C" }, () => {
      opened += 1;
    })?.open?.run();
    expect(opened).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });

  test("what was found while the person was away is said when they are back", async () => {
    const toasts: Array<{ title?: string; message: string }> = [];
    const start = (missed: unknown) =>
      startWatchdogReports({
        missed: async () => missed,
        onMessage: () => () => {},
        toast: (t) => void toasts.push(t),
        open: () => {},
      });
    start({ roundId: "missed", findings: 3, agentName: "Cerberus" });
    start(null);
    await settle();
    expect(toasts).toEqual([
      expect.objectContaining({
        title: "Cerberus is back from its round",
        message: "3 findings for you to look at.",
      }),
    ]);
  });
});
