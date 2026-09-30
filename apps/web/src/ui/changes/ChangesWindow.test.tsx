import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { ChangedFile, ChangesSnapshot, FileDiff, FileSig } from "@regulus/protocol";
import { act } from "react";
import { click, mount, useDom } from "../a11y/dom.ts";
import { AgentPanel } from "../agent/AgentPanel.tsx";
import { useAgentStore } from "../agent/agentStore.ts";
import { ROBOT_OWNER, recorder, seed } from "../agent/testHarness.tsx";
import type { ChangesApi, ChangesFailure } from "./api.ts";
import { ChangesWindowHost } from "./ChangesWindow.tsx";
import { useChangesWindow } from "./changesStore.ts";

useDom();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  kind: "modified",
  uncommitted: true,
  additions: 2,
  deletions: 1,
  binary: false,
  symlink: false,
  sig: `sig-${path}`,
  ...over,
});

const snap = (files: ChangedFile[], canWrite: boolean): ChangesSnapshot => ({
  agentId: "a1",
  branch: "office/fix",
  head: "h".repeat(40),
  base: { ref: "origin/main", sha: "b".repeat(40) },
  ahead: 2,
  files,
  truncated: false,
  polledAt: 1,
  canWrite,
});

const diff = (path: string, over: Partial<FileDiff> = {}): FileDiff => ({
  path,
  kind: "modified",
  binary: false,
  symlink: false,
  tooLarge: false,
  truncated: false,
  hunks: [
    {
      header: "@@ -1 +1,2 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [
        { t: "del", text: "old line", old: 1 },
        { t: "add", text: "new line", new: 1 },
      ],
    },
  ],
  image: null,
  ...over,
});

function fakeApi(snapshot: ChangesSnapshot, opts: { commitFails?: ChangesFailure } = {}) {
  const calls: {
    commit: { message: string; files: FileSig[] }[];
    discard: FileSig[];
    image: string[];
  } = {
    commit: [],
    discard: [],
    image: [],
  };
  const api = {
    snapshot: async () => ({ ok: true as const, data: snapshot }),
    file: async (_a: string, path: string) => ({
      ok: true as const,
      data: path.endsWith(".png")
        ? diff(path, { binary: true, hunks: [], image: { base: true, work: true } })
        : diff(path),
    }),
    image: async (_a: string, path: string, side: string) => {
      calls.image.push(`${path}:${side}`);
      return { ok: true as const, data: { bytes: PNG, type: "image/png" } };
    },
    commit: async (_a: string, message: string, files: FileSig[]) => {
      calls.commit.push({ message, files });
      if (opts.commitFails) return opts.commitFails;
      return { ok: true as const, data: { sha: "abcdef1234", files: files.length } };
    },
    discard: async (_a: string, f: FileSig) => {
      calls.discard.push(f);
      return { ok: true as const, data: { discarded: f.path } };
    },
  };
  return { api: api as unknown as ChangesApi, calls };
}

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const text = () => document.body.textContent ?? "";
const buttonByText = (label: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const submitCommit = () =>
  act(async () => {
    document
      .querySelector("form[aria-label=Commit]")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const buttonByLabel = (label: string) =>
  document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

let unmount: (() => Promise<void>) | null = null;
const revoked: string[] = [];

beforeAll(() => {
  URL.createObjectURL = () => "blob:office/preview-1";
  URL.revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
});

afterEach(async () => {
  await unmount?.();
  unmount = null;
  useChangesWindow.getState().closeChanges();
});

async function open(api: ChangesApi) {
  useChangesWindow.getState().openChanges("a1");
  const m = await mount(<ChangesWindowHost api={api} />);
  unmount = m.unmount;
  await settle();
}

describe("changes window", () => {
  test("a watcher sees the tree and diffs read-only: no commit, no checkboxes, no discard", async () => {
    seed({ userId: "someone-else", robot: { status: "working" } });
    const { api } = fakeApi(
      snap([file("src/a.ts"), file("README.md", { uncommitted: false })], false),
    );
    await open(api);
    expect(text()).toContain("office/fix");
    expect(text()).toContain("2 commits · 1 uncommitted");
    expect(text()).toContain("Read only: only Mia can commit or discard");
    expect(text()).toContain("new line");
    expect(document.querySelector("input[type=checkbox]")).toBeNull();
    expect(document.querySelector("form[aria-label=Commit]")).toBeNull();
    expect(buttonByLabel("Discard changes to src/a.ts")).toBeNull();
    expect(buttonByText("Push and open PR…")).toBeUndefined();
  });

  test("the owner commits the chosen files with their fingerprints", async () => {
    seed({ userId: ROBOT_OWNER, robot: { status: "working" } });
    const { api, calls } = fakeApi(
      snap([file("a.ts"), file("b.ts"), file("c.ts", { uncommitted: false })], true),
    );
    await open(api);
    await submitCommit();
    expect(text()).toContain("Write a commit message first.");
    await click(
      document.querySelector('input[aria-label="Include b.ts in the commit"]') as HTMLElement,
    );
    const box = document.querySelector("form[aria-label=Commit] textarea") as HTMLTextAreaElement;
    await act(async () => {
      box.value = "  Fix the thing ";
    });
    expect(text()).toContain("1 of 2 uncommitted files selected");
    expect((buttonByText("Commit") as HTMLButtonElement).disabled).toBe(false);
    await submitCommit();
    await settle();
    expect(calls.commit).toEqual([
      { message: "Fix the thing", files: [{ path: "a.ts", sig: "sig-a.ts" }] },
    ]);
    expect(text()).toContain("Committed 1 file as abcdef1");
  });

  test("a commit refused because the robot edited a file names the file", async () => {
    seed({ userId: ROBOT_OWNER, robot: { status: "working" } });
    const { api } = fakeApi(snap([file("a.ts")], true), {
      commitFails: { ok: false, status: 409, code: "changed_since_viewed", files: ["a.ts"] },
    });
    await open(api);
    const box = document.querySelector("form[aria-label=Commit] textarea") as HTMLTextAreaElement;
    await act(async () => {
      box.value = "msg";
    });
    expect((buttonByText("Commit") as HTMLButtonElement).disabled).toBe(false);
    await submitCommit();
    await settle();
    const alert = document.querySelector("[data-testid=changes-alert]")?.textContent ?? "";
    expect(alert).toContain("changed these files after you looked");
    expect(alert).toContain("a.ts");
  });

  test("discard asks for confirmation first", async () => {
    seed({ userId: ROBOT_OWNER, robot: { status: "working" } });
    const { api, calls } = fakeApi(snap([file("new.txt", { kind: "untracked" })], true));
    await open(api);
    await click(buttonByLabel("Discard changes to new.txt") as HTMLButtonElement);
    expect(text()).toContain("The file will be deleted");
    expect(calls.discard).toEqual([]);
    await click(buttonByText("Cancel") as HTMLButtonElement);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    await click(buttonByLabel("Discard changes to new.txt") as HTMLButtonElement);
    await click(buttonByText("Discard") as HTMLButtonElement);
    await settle();
    expect(calls.discard).toEqual([{ path: "new.txt", sig: "sig-new.txt" }]);
  });

  test("images preview through blob URLs, revoked when closed", async () => {
    seed({ userId: "someone-else", robot: { status: "working" } });
    const { api, calls } = fakeApi(
      snap([file("logo.png", { binary: true, additions: null })], false),
    );
    await open(api);
    const imgs = Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(imgs).toEqual(["blob:office/preview-1", "blob:office/preview-1"]);
    expect(calls.image.sort()).toEqual(["logo.png:base", "logo.png:work"]);
    await unmount?.();
    unmount = null;
    expect(revoked).toContain("blob:office/preview-1");
  });

  test("push and open PR hands over to the PR dialog once everything is committed", async () => {
    seed({ userId: ROBOT_OWNER, robot: { status: "working" } });
    const { api } = fakeApi(snap([file("a.ts", { uncommitted: false })], true));
    await open(api);
    await click(buttonByText("Push and open PR…") as HTMLButtonElement);
    expect(useChangesWindow.getState().agentId).toBeNull();
    expect(useAgentStore.getState().panelAgentId).toBe("a1");
    expect(useAgentStore.getState().dialog).toBe("pr");
  });

  test("the robot panel opens the window for watchers and for the owner", async () => {
    seed({ userId: "someone-else", robot: { status: "working" } });
    const { wrap } = recorder();
    useAgentStore.getState().openAgentPanel("a1");
    const m = await mount(wrap(<AgentPanel />));
    await click(buttonByText("View changes") as HTMLButtonElement);
    expect(useChangesWindow.getState().agentId).toBe("a1");
    await m.unmount();
    seed({ robot: { status: "working" } });
    useAgentStore.getState().openAgentPanel("a1");
    const m2 = await mount(wrap(<AgentPanel />));
    expect(buttonByText("Review changes")).toBeDefined();
    await m2.unmount();
  });
});
