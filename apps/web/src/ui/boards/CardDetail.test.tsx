import { afterEach, describe, expect, test } from "bun:test";
import type { BoardCardDetail } from "@regulus/protocol";
import { click, useDom } from "../a11y/dom.ts";
import type { BoardsApi } from "./api.ts";
import { CardDetail } from "./CardDetail.tsx";
import { button, renderPlain, settle, text } from "./testDom.tsx";

useDom();

const detail = (over: Partial<BoardCardDetail> = {}): BoardCardDetail => ({
  kind: "pr",
  repoId: "r1",
  repo: "octo/hello",
  number: 9,
  title: "Speed up tests",
  state: "open",
  merged: false,
  draft: false,
  author: "henchman",
  labels: ["perf"],
  assignees: [],
  url: "https://github.com/octo/hello/pull/9",
  bodyMd: 'Hi <img src=x onerror="alert(1)"> [x](javascript:alert(1))',
  updatedAt: 1,
  headBranch: "office/speed",
  baseBranch: "main",
  checksState: "failure",
  reviewState: "approved",
  comments: [{ id: 1, author: "olga", bodyMd: "<script>alert(2)</script>", createdAt: 1, url: "" }],
  commentsError: null,
  canWrite: false,
  credential: true,
  ...over,
});

function fakeApi(d: BoardCardDetail) {
  const calls: string[] = [];
  const api = {
    detail: async () => ({ ok: true as const, data: d }),
    assignees: async () => ({ ok: true as const, data: { logins: ["ada"] } }),
    comment: async () => {
      calls.push("comment");
      return { ok: true as const, data: d.comments[0] as never };
    },
    assign: async () => ({ ok: true as const, data: undefined }),
    merge: async (_c: unknown, method: string) => {
      calls.push(`merge:${method}`);
      return { ok: true as const, data: { merged: true } };
    },
    close: async () => ({ ok: true as const, data: undefined }),
  } as unknown as BoardsApi;
  return { api, calls };
}

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function show(d: BoardCardDetail, canCarry = true) {
  const { api, calls } = fakeApi(d);
  const m = await renderPlain(
    <CardDetail
      api={api}
      cardRef={{ operationId: "f1", kind: d.kind, repoId: d.repoId, number: d.number }}
      summaryTitle={d.title}
      canCarry={canCarry}
      onBack={() => {}}
      onCarried={() => {}}
    />,
  );
  unmount = m.unmount;
  await settle();
  return calls;
}

describe("card detail", () => {
  test("body and comments are rendered sanitised; status badges show", async () => {
    await show(detail());
    expect(document.querySelector(".rg-card img, .rg-card script")).toBeNull();
    expect(document.querySelector('.rg-card a[href^="javascript"]')).toBeNull();
    expect(text()).toContain('<img src=x onerror="alert(1)">');
    expect(text()).toContain("<script>alert(2)</script>");
    expect(text()).toContain("Checks failing");
    expect(text()).toContain("Approved");
    expect(text()).toContain("office/speed → main");
  });

  test("without manage there are no write actions; carrying needs spawn", async () => {
    await show(detail(), false);
    expect(button("Merge")).toBeUndefined();
    expect(button("Comment")).toBeUndefined();
    expect(button("Carry to a desk")).toBeUndefined();
  });

  test("a manager merges after confirming, with the chosen method", async () => {
    const calls = await show(detail({ canWrite: true }));
    expect(button("Carry to a desk")).toBeDefined();
    expect(text()).toContain("Posted as");
    await click(button("Merge…") as HTMLButtonElement);
    expect(calls).toEqual([]);
    await click(button("Confirm merge") as HTMLButtonElement);
    await settle();
    expect(calls).toEqual(["merge:squash"]);
  });

  test("merged PRs offer no merge or close", async () => {
    await show(detail({ canWrite: true, state: "closed", merged: true }));
    expect(button("Merge…")).toBeUndefined();
    expect(button("Close pull request…")).toBeUndefined();
    expect(text()).toContain("Merged");
  });
});
