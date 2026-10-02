/**
 * Turn prompts and the `.meeting/` notes layout (#50). Henchmen share one
 * worktree; every turn ends with the henchman writing its contribution to
 * `.meeting/turns/<step>-r<round>-<name>.md`, which the office reads back as
 * the starter's runner identity. The notes are the meeting's memory: each
 * prompt tells the henchman to read them, so prompts stay short however long
 * the meeting runs. Git ignores `.meeting/` (the clone's `info/exclude`).
 */
import {
  MEETING_PATTERN_LABELS,
  type MeetingOutput,
  type MeetingPattern,
  type MeetingRole,
  type MeetingTurnKind,
} from "@regulus/protocol";

export const NOTES_DIR = ".meeting";
export const REVIEW_FILE = `${NOTES_DIR}/review.md`;

export interface PromptMember {
  position: number;
  role: MeetingRole;
  name: string;
}

export interface TurnPromptInput {
  pattern: MeetingPattern;
  topic: string;
  rounds: number;
  round: number;
  step: number;
  kind: MeetingTurnKind;
  member: PromptMember;
  members: readonly PromptMember[];
  branch: string;
  output: MeetingOutput;
  prNumber: number | null;
  /** The pull request's base branch, for review panels. */
  baseBranch: string;
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "member";

/** The turn's notes file, relative to the worktree. */
export function turnFile(step: number, round: number, name: string): string {
  return `${NOTES_DIR}/turns/${String(step + 1).padStart(3, "0")}-r${round}-${slug(name)}.md`;
}

/** Display names: the role, numbered when several members share it. */
export function memberNames(roles: readonly MeetingRole[], label: (r: MeetingRole) => string) {
  const totals = new Map<MeetingRole, number>();
  for (const r of roles) totals.set(r, (totals.get(r) ?? 0) + 1);
  const seen = new Map<MeetingRole, number>();
  return roles.map((r) => {
    const n = (seen.get(r) ?? 0) + 1;
    seen.set(r, n);
    return (totals.get(r) ?? 0) > 1 ? `${label(r)} ${n}` : label(r);
  });
}

const names = (members: readonly PromptMember[]) => members.map((m) => m.name).join(", ");

function instruction(input: TurnPromptInput): string {
  const { kind, members, pattern, prNumber, baseBranch } = input;
  const others = members.filter((m) => m.position !== 0);
  const diff = `git diff origin/${baseBranch}...HEAD`;
  switch (kind) {
    case "plan":
      return pattern === "map_reduce"
        ? `Split the task into ${others.length} independent slices, one for each mapper (${names(others)}). Describe each slice precisely: files, scope, what done means. Do not implement anything yet.`
        : `Plan the work and give each engineer (${names(others)}) one part of it: files, scope, what done means. Do not implement anything yet.`;
    case "open":
      return "State your position on the task and argue for it. Propose a concrete approach and say what it costs.";
    case "rebut":
      return "Answer the other positions in the notes: where you agree, where you disagree and why. Refine your proposal.";
    case "work":
      return "Implement your part of the lead's plan in this working directory. Do not commit. Say what you changed and what is left.";
    case "review":
      return pattern === "review_panel"
        ? `Review pull request #${prNumber} on your own: this worktree is its head; see \`${diff}\`. List bugs, security problems and missing tests with file:line. Do not change any files.`
        : "Review and integrate the engineers' work in this working directory: fix conflicts and mistakes, run the tests, and write what each engineer should do next round.";
    case "discuss":
      return "Read the other reviews in the notes. Say where you agree or disagree, drop findings that do not hold and add what the others missed. Do not change any files.";
    case "map":
      return "Work on your slice only (see the plan in the notes) in this working directory; touch only the files of your slice. Do not commit. Describe your result.";
    case "reduce":
      return "Merge the mappers' results in this working directory: check they fit together, fix conflicts, run the tests, and say what the next round should refine.";
    case "build":
      return "Blue team: implement the task in this working directory. Do not commit. Describe what you built.";
    case "attack":
      return "Red team: attack blue's work in this working directory. Find bugs, security holes, edge cases and missing tests; add failing tests where you can. Do not fix anything; report each finding precisely.";
    case "fix":
      return "Blue team: fix what red found (see the notes). Keep the fixes small and run the tests. Do not commit. Say what you fixed and what you did not.";
    case "final":
      return closing(input);
  }
}

function closing(input: TurnPromptInput): string {
  const lead =
    input.pattern === "debate"
      ? "Weigh the arguments in the notes and decide. Write the decision and its reasons."
      : input.pattern === "review_panel"
        ? "Close the review panel."
        : "Close the meeting: make sure the working directory holds the finished, working change.";
  switch (input.output) {
    case "pull_request":
      return `${lead} Then commit the change on the current branch (${input.branch}) with a clear message; \`${NOTES_DIR}/\` is ignored by git. Do not push: the office opens the pull request. Your notes become its description.`;
    case "pr_review":
      return `${lead} Write the meeting's single review of pull request #${input.prNumber} to \`${REVIEW_FILE}\`: a short summary first, then the findings everyone agrees on, most severe first, with file:line. The office posts it as a comment review. Do not commit anything.`;
    case "notes":
      return `${lead} Write the outcome in your notes. Do not commit anything.`;
  }
}

/** The prompt for one turn. */
export function turnPrompt(input: TurnPromptInput): string {
  const { member, members } = input;
  const file = turnFile(input.step, input.round, member.name);
  return [
    `[Regulus Office meeting: ${MEETING_PATTERN_LABELS[input.pattern]}, round ${input.round} of ${input.rounds}]`,
    `You are ${member.name} in a meeting of ${members.length} henchmen: ${names(members)}.`,
    `You all share this working directory (branch ${input.branch}). The meeting's notes are in \`${NOTES_DIR}/\`; read every file in \`${NOTES_DIR}/turns/\` in name order before you start (there are none on the first turn).`,
    "",
    "The task:",
    input.topic,
    "",
    `Your turn: ${instruction(input)}`,
    "",
    `When you are done, write your contribution as Markdown to \`${file}\` (create the directory if needed), keep it under 300 lines, and stop.`,
  ].join("\n");
}
