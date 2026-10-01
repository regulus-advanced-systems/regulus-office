/**
 * A queued task's title and prompt (#37). Freeform tasks bring their own
 * prompt; an issue or PR task without one gets a prompt from the board cache
 * (#35), worded like a card dropped on a desk (#36). Titles follow the spawn
 * dialog's: `#N title` for issues, `PR #N title` for PRs, else the prompt's
 * first line.
 */
import type { TaskKind } from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { githubIssues, githubPulls, operationRepos } from "../db/schema/index.ts";

const MAX_TITLE = 200;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

interface CardInfo {
  title: string;
  url: string;
  headRef: string;
}

function cardInfo(db: Db, kind: "issue" | "pr", repoId: string, number: number): CardInfo | null {
  if (kind === "issue") {
    const row = db
      .select({ title: githubIssues.title, raw: githubIssues.raw })
      .from(githubIssues)
      .where(and(eq(githubIssues.repoId, repoId), eq(githubIssues.number, number)))
      .get();
    return row ? { title: row.title, url: htmlUrl(row.raw), headRef: "" } : null;
  }
  const row = db
    .select({ title: githubPulls.title, raw: githubPulls.raw, headRef: githubPulls.headRef })
    .from(githubPulls)
    .where(and(eq(githubPulls.repoId, repoId), eq(githubPulls.number, number)))
    .get();
  return row ? { title: row.title, url: htmlUrl(row.raw), headRef: row.headRef ?? "" } : null;
}

function htmlUrl(raw: string): string {
  try {
    const url = (JSON.parse(raw) as { html_url?: unknown }).html_url;
    return typeof url === "string" && /^https?:\/\//.test(url) ? url : "";
  } catch {
    return "";
  }
}

export interface TaskContentInput {
  operationId: string;
  repoId: string;
  kind: TaskKind;
  refNumber?: number;
  title?: string;
  prompt: string;
}

/** The title and prompt to store; the repo must be one of the operation's. */
export function taskContent(db: Db, input: TaskContentInput): { title: string; prompt: string } {
  const typed = input.title?.trim() ?? "";
  if (input.kind === "freeform" || input.refNumber === undefined) {
    const title = typed || input.prompt.split("\n")[0]?.trim() || "Task";
    return { title: clip(title, MAX_TITLE), prompt: input.prompt };
  }
  const n = input.refNumber;
  const card = cardInfo(db, input.kind, input.repoId, n);
  const repo = db
    .select({ owner: operationRepos.owner, name: operationRepos.name })
    .from(operationRepos)
    .where(
      and(eq(operationRepos.id, input.repoId), eq(operationRepos.operationId, input.operationId)),
    )
    .get();
  const name = card?.title ?? "";
  const where = repo ? ` in ${repo.owner}/${repo.name}` : "";
  const link = card?.url ? `\n\n${card.url}` : "";
  if (input.kind === "issue") {
    return {
      title: clip(typed || `#${n} ${name}`.trim(), MAX_TITLE),
      prompt: input.prompt || `Work on issue #${n}${where}: ${name}${link}`.trim(),
    };
  }
  const branch = card?.headRef ? ` (branch ${card.headRef})` : "";
  return {
    title: clip(typed || `PR #${n} ${name}`.trim(), MAX_TITLE),
    prompt: input.prompt || `Pick up pull request #${n}${branch}${where}: ${name}${link}`.trim(),
  };
}
