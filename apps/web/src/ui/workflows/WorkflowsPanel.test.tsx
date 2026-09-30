/** The floor's workflows panel (#155): list, editor rules, dry run, run history. */
import { afterEach, describe, expect, test } from "bun:test";
import {
  defaultWorkflowSpec,
  type WorkflowListResponse,
  type WorkflowRunView,
  type WorkflowView,
} from "@regulus/protocol";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { createWorkflowsApi } from "./api.ts";
import { WorkflowsBody } from "./WorkflowsPanel.tsx";
import {
  floorIdFromWorkflowsOverlay,
  formatDuration,
  targetLabel,
  textToPatterns,
  triggerSummary,
  workflowsOverlay,
} from "./workflowForm.ts";

useDom();

const WF: WorkflowView = {
  ...defaultWorkflowSpec(),
  enabled: true,
  id: "w1",
  floorId: "f1",
  createdBy: "u1",
  createdAt: 1,
  updatedAt: 1,
  today: { runs: 2, tokens: 12_500, costUsd: 0.1 },
};
const RUN: WorkflowRunView = {
  id: "run-1",
  workflowId: "w1",
  workflowName: WF.name,
  floorId: "f1",
  trigger: "pull_request.opened",
  deliveryId: "d1",
  target: {
    kind: "pull",
    repo: "octo/hello",
    number: 7,
    sha: "abc",
    title: "Add b",
    url: "https://github.example/octo/hello/pull/7",
  },
  status: "succeeded",
  reason: null,
  provider: "claude-code",
  model: null,
  robot: "Reviewer RUN-",
  queuedAt: 1,
  startedAt: 1_000,
  finishedAt: 43_000,
  inputTokens: 1200,
  outputTokens: 340,
  costUsd: 0.01,
  links: [{ kind: "review", url: "https://github.example/octo/hello/pull/7#review-1" }],
};

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
});

async function show(
  list: Partial<WorkflowListResponse>,
  routes: Parameters<typeof fakeFetch>[0] = {},
) {
  const f = fakeFetch({
    "GET /api/workflows": {
      body: { workflows: [WF], canEdit: false, canApprove: false, missing: [], ...list },
    },
    "GET /api/workflows/runs": { body: { runs: [RUN] } },
    "GET /api/workflows/events": {
      body: {
        events: [
          {
            id: "e1",
            floorIds: ["f1"],
            name: "pull_request.opened",
            repo: "octo/hello",
            summary: "octo/hello#7 Add b",
            sender: "alice",
            receivedAt: 1,
          },
        ],
      },
    },
    ...routes,
  });
  mounted.push(
    await mount(
      <WorkflowsBody floorId="f1" api={createWorkflowsApi({ fetch: f.fetch })} pollMs={0} />,
    ),
  );
  await settle();
  return f;
}

describe("helpers", () => {
  test("overlay ids, patterns and labels", () => {
    expect(floorIdFromWorkflowsOverlay(workflowsOverlay("f1"))).toBe("f1");
    expect(floorIdFromWorkflowsOverlay("floor-settings:f1")).toBeNull();
    expect(textToPatterns("main\n release/*, \n\n")).toEqual(["main", "release/*"]);
    expect(triggerSummary({ kind: "command", command: "review" })).toBe("/office review");
    expect(targetLabel(RUN)).toBe("octo/hello#7");
    expect(formatDuration(RUN, 0)).toBe("42 s");
  });
});

describe("workflows panel", () => {
  test("floor members see workflows and runs but cannot edit", async () => {
    await show({ missing: ["github_app"] });
    expect(text()).toContain(WF.name);
    expect(text()).toContain("today 2 runs, 12.5k tokens");
    expect(text()).toContain("No GitHub App is connected");
    expect(button("New workflow")).toBeUndefined();
    expect(button("Edit")).toBeUndefined();
    await click(button("Runs") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("octo/hello#7");
    expect(text()).toContain("1.5k");
    const review = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === "review",
    );
    expect(review?.getAttribute("href")).toBe(RUN.links[0]?.url);
    expect(button("Cancel")).toBeUndefined();
  });

  test("managers create workflows with every action off; approve needs an admin", async () => {
    const f = await show(
      { canEdit: true, workflows: [] },
      {
        "POST /api/workflows": (call) => ({
          status: 201,
          body: { ...WF, ...(call.body as object) },
        }),
      },
    );
    await click(button("New workflow") as HTMLButtonElement);
    const approve = Array.from(document.querySelectorAll('[role="switch"]')).find((el) =>
      el.textContent?.startsWith("Allow approving"),
    ) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(text()).toContain("Only an office owner or admin can turn this on.");
    await click(button("Create workflow") as HTMLButtonElement);
    await settle();
    const sent = f.calls.find((c) => c.method === "POST")?.body as Record<string, unknown> & {
      actions: Record<string, { enabled: boolean }>;
    };
    expect(sent.floorId).toBe("f1");
    expect(Object.values(sent.actions).every((a) => a.enabled === false)).toBe(true);
  });

  test("a dry run shows whether it would run, what it would post and the prompt", async () => {
    await show(
      { canEdit: true, canApprove: true },
      {
        "POST /api/workflows/w1/dry-run": {
          body: {
            matched: true,
            reasons: ["pull_request.opened matches the pull_request trigger"],
            target: RUN.target,
            prompt: "Review <<<UNTRUSTED-preview\nAdd b\nUNTRUSTED-preview>>>",
            actions: ["PR review (comment review) with inline comments"],
            safety: ["the robot does not run any code from the PR"],
          },
        },
      },
    );
    await click(button("Edit") as HTMLButtonElement);
    await settle();
    await click(button("Dry run") as HTMLButtonElement);
    await settle();
    const result = document.querySelector('[data-testid="dry-run-result"]')?.textContent ?? "";
    expect(result).toContain("Would run.");
    expect(result).toContain("PR review (comment review)");
    expect(result).toContain("does not run any code");
  });
});
