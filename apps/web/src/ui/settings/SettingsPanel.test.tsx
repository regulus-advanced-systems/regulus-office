/**
 * Settings as a tabbed dialog (#225): ARIA tabs with arrow keys, Home and
 * End; Office and Henchmen only for owners and admins; the open tab is
 * remembered for the session; the GitHub manifest return lands on Office.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UserRole } from "@regulus/protocol";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import { settle } from "../auth/testDom.tsx";
import { SettingsForm } from "./SettingsPanel.tsx";
import {
  effectiveSettingsTab,
  loadSettingsTab,
  openSettingsAt,
  SETTINGS_TAB_STORAGE_KEY,
  saveSettingsTab,
  useSettingsTabStore,
  visibleSettingsTabs,
} from "./settingsTabs.ts";

useDom();

// The sections load from the server; these tests are about the tabs, so nothing answers.
// Stubbed per test, inside the DOM's lifetime (useDom swaps the globals in beforeAll/afterAll),
// so the fetch put back is exactly the one this test replaced and nothing leaks to later files.
let fetchBefore: typeof fetch | undefined;
beforeEach(() => {
  fetchBefore = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
});

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  if (fetchBefore) globalThis.fetch = fetchBefore;
  fetchBefore = undefined;
  useSessionStore.setState({ status: "unknown", user: null, error: null });
  useSettingsTabStore.setState({ tab: "you" });
  useUiStore.getState().closeOverlay();
  sessionStorage.clear();
});

async function show(role: UserRole) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });
  mounted.push(await mount(<SettingsForm />));
  await settle();
}

const tabs = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const tabNames = () => tabs().map((t) => t.textContent);
const tab = (name: string) => {
  const t = tabs().find((el) => el.textContent === name);
  if (!t) throw new Error(`no tab ${name}`);
  return t;
};
const selected = () => tabs().find((t) => t.getAttribute("aria-selected") === "true")?.textContent;
const visiblePanel = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter((p) => !p.hidden);

describe("settings tabs", () => {
  test("owners and admins see every tab; members do not see Office or Henchmen", async () => {
    expect(visibleSettingsTabs("owner")).toEqual([
      "you",
      "office",
      "henchmen",
      "notifications",
      "display",
    ]);
    expect(visibleSettingsTabs("admin")).toHaveLength(5);
    await show("member");
    expect(tabNames()).toEqual(["You", "Notifications", "Display and sound"]);
    expect(document.body.textContent).not.toContain("Henchman skins");
    // The office's GitHub connection is for owners and admins; everyone has their own link (#267).
    expect(document.querySelector('section[aria-label="GitHub"]')).toBeNull();
    expect(document.querySelector('section[aria-label="Your GitHub account"]')).not.toBeNull();
  });

  test("a tablist with one tab stop; each panel is labelled by its tab", async () => {
    await show("owner");
    const list = document.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe("Settings sections");
    expect(tabNames()).toEqual(["You", "Office", "Henchmen", "Notifications", "Display and sound"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    const [panel] = visiblePanel();
    expect(visiblePanel()).toHaveLength(1);
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab("You").id);
    expect(tab("You").getAttribute("aria-controls")).toBe(panel?.id ?? "");
    // Every tab controls a panel that exists, though only the open one has content.
    for (const t of tabs())
      expect(document.getElementById(t.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(panel?.textContent).toContain("Account");
  });

  test("arrow keys, Home and End move between tabs and open them", async () => {
    await show("owner");
    tab("You").focus();
    await press(document.activeElement as Element, "ArrowDown");
    expect(selected()).toBe("Office");
    expect(document.activeElement).toBe(tab("Office"));
    expect(visiblePanel()[0]?.textContent).toContain("GitHub");
    await press(document.activeElement as Element, "ArrowRight");
    expect(selected()).toBe("Henchmen");
    await press(document.activeElement as Element, "End");
    expect(selected()).toBe("Display and sound");
    expect(document.activeElement).toBe(tab("Display and sound"));
    expect(visiblePanel()[0]?.textContent).toContain("Reduce motion");
    await press(document.activeElement as Element, "ArrowDown");
    expect(selected()).toBe("You");
    await press(document.activeElement as Element, "ArrowUp");
    expect(selected()).toBe("Display and sound");
    await press(document.activeElement as Element, "Home");
    expect(selected()).toBe("You");
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  test("members move only between their own tabs", async () => {
    await show("member");
    tab("You").focus();
    await press(document.activeElement as Element, "ArrowDown");
    expect(selected()).toBe("Notifications");
    await press(document.activeElement as Element, "ArrowLeft");
    await press(document.activeElement as Element, "ArrowLeft");
    expect(selected()).toBe("Display and sound");
  });

  test("the open tab is remembered for the session", async () => {
    await show("owner");
    await click(tab("Henchmen"));
    expect(sessionStorage.getItem(SETTINGS_TAB_STORAGE_KEY)).toBe("henchmen");
    expect(loadSettingsTab()).toBe("henchmen");
    for (const m of mounted.splice(0)) await m.unmount();
    mounted.push(await mount(<SettingsForm />));
    expect(selected()).toBe("Henchmen");
  });

  test("a remembered admin tab falls back to You for a member", async () => {
    useSettingsTabStore.setState({ tab: "office" });
    await show("member");
    expect(selected()).toBe("You");
    expect(effectiveSettingsTab("henchmen", "member")).toBe("you");
    expect(effectiveSettingsTab("henchmen", "admin")).toBe("henchmen");
  });

  test("blocked storage forgets the tab instead of failing", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSettingsTab(blocked)).toBe("you");
    expect(() => saveSettingsTab("office", blocked)).not.toThrow();
    expect(loadSettingsTab({ getItem: () => "nonsense", setItem: () => {} })).toBe("you");
  });

  test("openSettingsAt opens the dialog on that tab (the GitHub return lands on Office)", async () => {
    openSettingsAt("office");
    expect(useUiStore.getState().overlay).toBe("settings");
    await show("owner");
    expect(selected()).toBe("Office");
  });
});
