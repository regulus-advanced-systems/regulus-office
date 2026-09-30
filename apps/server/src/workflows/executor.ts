/**
 * One workflow run, end to end (#155):
 *
 *  1. the App client for the repo (installation token; no App, no run);
 *  2. the target with fresh facts from GitHub (PR head, base, files, fork);
 *  3. commands: the commenter needs write access to the repo;
 *  4. the strict filter pass (paths, base branch, drafts) → else `skipped`;
 *  5. safety: `fix` is refused (not available yet, and never for forks);
 *     PR code runs only when allowed and the PR is from the same repo;
 *  6. the office's API key for the provider (D2) → else `refused`;
 *  7. a throwaway checkout, read-only unless code may run;
 *  8. the robot in its own sandbox of the workflow runner identity, one
 *     headless read-only CLI run with a timeout;
 *  9. its JSON answer, validated, posted as the App; usage to `office`.
 *
 * The run log holds steps only: never a token, key, prompt or model output.
 */
import type { WorkflowRunLink } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { Db } from "../db/index.ts";
import { floors } from "../db/schema/index.ts";
import type { GitHubConnection } from "../github/connection.ts";
import type { GitRunner } from "../github/git.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import { type AppRepoClient, appClientFor, canWrite, WorkflowRefusal } from "./github-app.ts";
import { matchWorkflow } from "./match.ts";
import { officeKey } from "./office-key.ts";
import { checkSummary, plannedActions, postResult } from "./post.ts";
import { renderPrompt } from "./prompt.ts";
import { parseRobotOutput } from "./robot-output.ts";
import { buildRobotPlan } from "./robot-plan.ts";
import type { RunRow, RunStore } from "./runs.ts";
import type { StoredWorkflow } from "./store.ts";
import { resolveTarget } from "./target.ts";
import type { UsageRecorder } from "./usage.ts";
import {
  checkoutDir,
  makeReadOnly,
  prepareCheckout,
  removeCheckout,
  WORKFLOW_RUNNER_USER,
} from "./workspace.ts";

const STDOUT_MAX = 8 * 1024 * 1024;

export interface ExecutorDeps {
  db: Db;
  runs: RunStore;
  connection: Pick<GitHubConnection, "app" | "tokenFor" | "api">;
  repos: Pick<RepoAccess, "getRepo">;
  runner: Runner;
  git: GitRunner;
  keyring: MasterKeyring | undefined;
  worktreesDir: string;
  usage: UsageRecorder;
  logger: Logger;
  now: () => number;
  /** CLI overrides (tests: the fake `claude`). */
  commands?: { "claude-code"?: string; codex?: string };
}

class RunLog {
  readonly lines: string[] = [];
  constructor(
    private readonly now: () => number,
    private readonly persist: (lines: string[]) => void,
  ) {}
  add(line: string): void {
    this.lines.push(`${new Date(this.now()).toISOString().slice(11, 19)} ${line.slice(0, 900)}`);
    this.persist(this.lines);
  }
}

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size < cap) chunks.push(value.subarray(0, cap - size));
    size += value.length;
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class WorkflowExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  /** A run the office stopped in the middle of: its sandbox and checkout go. */
  async cleanup(runId: string, floorId: string): Promise<void> {
    await this.deps.runner.kill({ userId: WORKFLOW_RUNNER_USER, agentId: runId }).catch(() => {});
    const floor = this.deps.db
      .select({ slug: floors.slug })
      .from(floors)
      .where(eq(floors.id, floorId))
      .get();
    if (floor) {
      await removeCheckout(
        checkoutDir({ worktreesDir: this.deps.worktreesDir, floorSlug: floor.slug, runId }),
      );
    }
  }

  async execute(row: RunRow, wf: StoredWorkflow, signal: AbortSignal): Promise<void> {
    const { deps } = this;
    const spec = wf.spec;
    const log = new RunLog(deps.now, (lines) => deps.runs.progress(row.id, { log: lines }));
    const ctx = deps.runs.context(row);
    let links: WorkflowRunLink[] = [];
    let dir: string | null = null;
    let sandboxed = false;
    let check: { id: number; url: string } | null = null;
    let checkOpen = false;
    let appClient: AppRepoClient | null = null;
    const finish = (
      status: "succeeded" | "failed" | "refused" | "skipped" | "cancelled",
      reason: string | null,
      extra: Partial<Parameters<RunStore["finish"]>[1]> = {},
    ) => {
      if (reason) log.add(`${status}: ${reason}`);
      deps.runs.finish(row.id, {
        status,
        reason,
        now: deps.now(),
        log: log.lines,
        links,
        ...extra,
      });
    };
    try {
      log.add(`started for ${ctx.event} (${ctx.deliveryId.slice(0, 40)})`);
      if (!ctx.repo) throw new WorkflowRefusal("no_repo", "the event names no repository");
      const repoRow = ctx.repoIds
        .map((id) => deps.repos.getRepo(id))
        .find((r) => r && r.floorId === wf.floorId);
      if (!repoRow)
        throw new WorkflowRefusal("repo_not_on_floor", "the repo is no longer on the floor");
      const floor = deps.db
        .select({ slug: floors.slug })
        .from(floors)
        .where(eq(floors.id, wf.floorId))
        .get();
      if (!floor) throw new WorkflowRefusal("floor_gone", "the floor was deleted");
      const { client, token } = await appClientFor(deps.connection, ctx.repo);
      appClient = client;
      log.add("GitHub App token ready (installation token, this repo only)");

      const target = await resolveTarget(client, spec, ctx);
      deps.runs.progress(row.id, { target: target.view });
      log.add(
        `target: ${target.kind} ${target.view.repo}${target.number ? `#${target.number}` : ""}`,
      );

      if (spec.trigger.kind === "command") {
        const author = ctx.comment?.author ?? "";
        if (!author || ctx.comment?.authorIsBot) {
          throw new WorkflowRefusal("command_from_bot", "commands from bots are ignored");
        }
        const permission = await client.permission(author);
        if (!canWrite(permission)) {
          throw new WorkflowRefusal(
            "command_needs_write",
            `${author} has ${permission} access; commands need write access to the repo`,
          );
        }
        log.add(`command by ${author} (${permission} access)`);
      }
      const strict = matchWorkflow(spec, ctx, { strict: true });
      if (!strict.matched) return finish("skipped", strict.reasons.join("; "));

      const fork = target.pr?.fork ?? false;
      if (spec.actions.fix.enabled) {
        throw new WorkflowRefusal(
          fork ? "fork_pr_no_write" : "fix_not_available",
          fork
            ? "fork PRs never get write actions"
            : "the fix action is not available yet (#155 follow-up)",
        );
      }
      const runCommands = spec.robot.executePrCode && target.kind === "pull" && !fork;
      if (fork) log.add("fork PR: read-only review, no code execution, no approve, no labels");
      else if (spec.robot.executePrCode && !runCommands) log.add("no PR: code execution off");
      log.add(`will post: ${plannedActions(spec, { kind: target.kind, fork }).join("; ")}`);

      const apiKey = officeKey(deps.db, deps.keyring, spec.robot.provider);
      log.add(`model key: the office's ${spec.robot.provider} API key (usage → office)`);

      const checkout = await prepareCheckout(deps.git, {
        worktreesDir: deps.worktreesDir,
        floorSlug: floor.slug,
        runId: row.id,
        remoteUrl: repoRow.remoteUrl,
        mirror: repoRow.workdir,
        token,
        headRef: target.headRef,
        baseRef: target.baseRef,
      });
      dir = checkout.dir;
      target.sha ??= checkout.headSha;
      if (target.kind === "pull") target.sha = checkout.headSha;
      if (!runCommands) await makeReadOnly(checkout.dir);
      log.add(`checked out ${checkout.headSha.slice(0, 12)}${runCommands ? "" : " (read-only)"}`);
      if (signal.aborted) return finish("cancelled", "cancelled");

      const checkName = `Regulus Office: ${wf.spec.name}`.slice(0, 100);
      if (spec.actions.checkRun.enabled && target.sha && target.kind !== "issue") {
        check = await client.createCheckRun({
          name: checkName,
          headSha: target.sha,
          status: "in_progress",
          title: "Review in progress",
          summary: "A Regulus Office robot is reviewing this commit.",
        });
        checkOpen = true;
        writeAudit(deps.db, {
          userId: null,
          action: AUDIT_ACTIONS.workflowRunGitHubWrite,
          targetKind: "workflow_run",
          targetId: row.id,
          meta: { kind: "check_run", repo: target.view.repo, sha: target.sha },
        });
        if (check.url) links = [...links, { kind: "check_run", url: check.url }];
        deps.runs.progress(row.id, { links });
      }

      const user = { userId: WORKFLOW_RUNNER_USER };
      const handle = await deps.runner.provision(user);
      const mounted = await deps.runner.mountProject(user, {
        floorId: wf.floorId,
        repoId: repoRow.repoId,
        workdir: checkout.dir,
      });
      sandboxed = true;
      const sandbox = await deps.runner.sandbox?.(
        { userId: WORKFLOW_RUNNER_USER, agentId: row.id },
        { workdir: mounted.workdir },
      );
      log.add(
        sandbox ? `robot sandbox ready (${sandbox.host})` : "robot runs in the workflow runner",
      );

      const prompt = renderPrompt(
        spec,
        {
          ctx,
          files: checkout.files ?? ctx.files ?? null,
          diff: checkout.diff,
          repo: target.view.repo,
        },
        { canRunCommands: runCommands },
      );
      if (prompt.diffCut) log.add("diff shortened to fit the prompt");
      const plan = buildRobotPlan({
        runId: row.id,
        provider: spec.robot.provider,
        model: spec.robot.model,
        effort: spec.robot.effort,
        workdir: mounted.workdir,
        home: handle.home,
        backend: deps.runner.backend,
        prompt: prompt.text,
        apiKey,
        runCommands,
        command: deps.commands?.[spec.robot.provider],
      });
      const proc = await deps.runner.spawnPiped(user, plan);
      log.add(
        `robot started (${spec.robot.provider}${spec.robot.model ? ` ${spec.robot.model}` : ""})`,
      );
      let timedOut = false;
      const kill = () => proc.kill("SIGKILL");
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, spec.robot.timeoutMinutes * 60_000);
      signal.addEventListener("abort", kill, { once: true });
      const [stdout, , code] = await Promise.all([
        readCapped(proc.stdout, STDOUT_MAX),
        readCapped(proc.stderr, 64 * 1024),
        proc.exited,
      ]).finally(() => {
        clearTimeout(timer);
        signal.removeEventListener("abort", kill);
      });
      const result = parseRobotOutput(spec.robot.provider, stdout);
      const usage = result.usage;
      deps.usage.record({
        ...usage,
        provider: spec.robot.provider,
        ts: deps.now(),
        attributedTo: "office",
      });
      log.add(
        `robot exited ${code ?? "by signal"}: ${usage.inputTokens} in / ${usage.outputTokens} out tokens`,
      );
      if (signal.aborted) return finish("cancelled", "cancelled", { usage });
      if (timedOut) {
        return finish("failed", `robot timed out after ${spec.robot.timeoutMinutes} min`, {
          usage,
        });
      }
      if (!result.review) return finish("failed", result.error ?? "no review", { usage });

      const posted = await postResult(
        {
          db: deps.db,
          client,
          runId: row.id,
          workflowName: spec.name,
          spec,
          log: (l) => log.add(l),
        },
        { kind: target.kind, number: target.number, sha: target.sha, pr: target.pr },
        result.review,
        checkout.diff,
      );
      links = [...links, ...posted.links];
      if (check) {
        await client.completeCheckRun(check.id, {
          conclusion: "neutral",
          title: `Review: ${result.review.verdict.replace("_", " ")}`,
          summary: checkSummary(posted.review.body),
        });
        checkOpen = false;
        log.add("check run completed (neutral)");
      }
      finish("succeeded", null, { usage, summary: posted.review.body });
    } catch (err) {
      if (err instanceof WorkflowRefusal) return finish("refused", `${err.code}: ${err.message}`);
      const detail = err instanceof Error ? err.message : String(err);
      deps.logger.warn({ runId: row.id, err: detail.slice(0, 300) }, "workflow run failed");
      finish("failed", detail.slice(0, 300));
    } finally {
      if (check && checkOpen && appClient) {
        // A run that did not finish leaves no check spinning on the commit.
        await appClient
          .completeCheckRun(check.id, {
            conclusion: "neutral",
            title: "Review did not finish",
            summary: "The Regulus Office robot did not finish this review.",
          })
          .catch(() => {});
      }
      if (sandboxed) {
        await deps.runner
          .kill({ userId: WORKFLOW_RUNNER_USER, agentId: row.id })
          .catch((err) =>
            deps.logger.warn({ err, runId: row.id }, "removing the run sandbox failed"),
          );
      }
      if (dir) await removeCheckout(dir).catch(() => {});
    }
  }
}
