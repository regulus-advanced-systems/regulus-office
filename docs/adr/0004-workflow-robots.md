# ADR 0004: GitHub workflow robots

Date: 2026-09-30. Status: accepted (owner decisions on #155; implemented in #155).

## Context
The office should react to GitHub events ("review every new PR") and post as
its own GitHub App, never as a person. Robots so far belong to a human: they
run in that human's runner, on that human's credentials, at a desk, driven
through a TUI. A workflow robot acts for the company, reads attacker-written
text (PR titles, bodies, diffs, comments), and nobody is watching it.

## Decision
- **Identity.** Workflow robots run as their own runner identity,
  `officeworkflows`, through the same `Runner` interface (docker: its own
  runner container and a per-run sandbox; linux-user: its own account and
  scope). It has no human's HOME, logins or clones.
- **Credentials (D2).** Only an office-wide `api_key` credential profile of
  the provider (`userId` null), decrypted right before the plan is built and
  injected as env. Never a CLI login, never a base-URL plan key, never a
  GitHub token. Usage goes through the usage tracker's `recordUsage` (#40)
  attributed to `office`, with one dedupe key per run.
- **GitHub.** Every read and write uses a one-hour installation token
  narrowed to the one repo; a PAT connection is refused. Posts carry "via
  Regulus Office" and a hidden marker. Every write is audited.
- **Checkout.** A fresh `git init` in the identity's area on the floor, the PR
  head and base fetched by the office with the token scoped to the remote URL;
  no remote is stored, the tree is made read-only (without following
  symlinks), and it is removed after the run.
- **Robot.** One headless CLI run (`claude -p` / `codex exec`) with a JSON
  schema for the answer, via `Runner.spawnPiped`, with a timeout. Claude:
  `--tools Read,Grep,Glob` allowed only as `Read(./**)`, `Grep(./**)`,
  `Glob(./**)`, deny rules for `//proc/**`, `//sys/**`, `//etc/**`, `~/**`,
  `blockReadsOutsideWorkingDirectories`, `--permission-mode dontAsk`,
  `--setting-sources user`, `--strict-mcp-config`. Codex: `--sandbox read-only`,
  `approval_policy="never"`, shell and hooks disabled. "Run PR code" adds Bash
  / the shell (workspace-write) for same-repo PRs only.
- **Scrub.** The robot's env holds the model key and it reads attacker text,
  so its answer is checked before anything is posted, logged or stored: the
  run's secrets (office key, installation token) plain, split by invisible
  characters, base64 at any alignment, URL-encoded or hex, and generic
  provider key shapes. A hit fails the run with `secret_in_output` (audited)
  and posts nothing. Codex cannot scope reads, and Claude with "run PR code"
  has Bash, so for those the scrub is the defence.
- **Posting.** The office, not the robot, posts: inline comments only on
  changed lines, labels only from the allow-list, mentions defused. Approve
  only if an office admin turned it on; forks get a comment review at most.
- **Engine.** Subscribes to the #35 event bus. Loop protection: `fromOfficeApp`,
  the marker, `stale`. Dedupe: unique (workflow, delivery id). Guards: daily
  runs, daily tokens, per-target cooldown. Queue in `workflow_runs`;
  per-workflow concurrency and three runs office-wide.

## Consequences
- The prompt travels as one CLI argument, so it is capped at 110 KB (the diff
  is shortened first); the robot reads the rest from the checkout.
- Network egress of the sandbox is not restricted at the network level: the
  robot's tools cannot reach the network (no WebFetch/WebSearch/Bash for
  Claude; Codex's sandbox has no network), and there is nothing to exfiltrate
  but the model key it already uses. An egress allowlist is a follow-up.
- `fix` (pushing robots), `.regulus/workflows.yml`, the review desk zone,
  enqueueing tasks and notify actions are follow-ups.
