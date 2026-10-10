# 0011: One task across several repos is a part in each room

## Context

A room has one repo (D7 as changed on 2026-10-07, #251), so a feature that
touches two repos would be two unrelated tasks in two rooms. Issue #257 asks
for one task across several repos on the same level, and asks that the spec
say so before it is built. The spec names the feature (D7 "work across repos
is one task with a henchman and a PR per room", §10 M5) but not its rules.
This ADR records them until the owner puts them in the spec; the last
section is proposed wording.

What constrains the design:

- A room's live state (`OperationState`) is the same for everyone in the
  room. Some of them may not see the task's other rooms (D26, D27).
- Everyone with any access to a room watches its henchmen: their terminals
  and laptop screens, the persisted scrollback through search, and the
  untracked files in the changes window (D12). So **whatever is in a
  henchman's worktree or terminal is readable by the people who see that
  room**, and those are not the people who see the task's other rooms. That
  the parts have one owner does not help: the audiences differ.
- A henchman's sandbox sees only its owner's area of its own room (§8, D17,
  D18), so two parts cannot share a directory, and the files in a worktree
  are under the henchman's control, not the office's.
- A henchman runs as the person who started it, with their credentials, only
  while they may work in that room (§8, D34).

## Decision

- **A linked task is 2 to 6 ordinary queue tasks**, one per room, all on one
  level, with one owner, one task text and one model (`linked_tasks`, and
  `tasks.linked_task_id`; protocol `linked-tasks.ts`). Each part waits in its
  own room's queue and follows every rule of that queue: its room's slots and
  desks, started as its owner, held while the owner may not spawn there. So
  the parts may start at different times.
- **One henchman per repo**, not one henchman with a worktree of each repo
  (upstream agent-office #173). A single henchman would need a sandbox that
  sees two rooms' areas, would sit at one desk while working in a room where
  nobody sees it, and its terminal would show the other repo's files to
  people without access to it.
- **Creating** needs `spawn` or `manage` (GitHub write, D34) in every room
  named. A room the person cannot work in, cannot see or that does not exist
  gives the same refusal. The task and all its parts are written in one
  transaction.
- **Seeing.** Nothing about a linked task is in a room's live state, and
  nothing the office writes on a part's queue row says the part belongs to
  more. A viewer asks `GET /api/linked-tasks?operationId=` and gets the parts
  in rooms open to them, and only when that is at least two; counts and the
  combined state (work: queued, working, finished, needs a look; pull
  requests: all open, some merged, all merged) cover those parts only. With
  one visible part the task is an ordinary task. The task's owner is filtered
  the same way.
- **Stopping.** The owner stops every part they still have queued or running.
  A running part counts as stopped once its henchman has stopped; one that
  cannot be stopped (the owner lost the room) is reported and carries on.
  Finished parts are left alone: their henchmen hold finished work and an open
  pull request the owner may still want changed. A part is cancelled in its
  room by the queue's own rules, and a part that fails is shown as failed; the
  others go on.
- **What a henchman is told.** The room's queue shows the text the owner
  wrote. The henchman also gets a paragraph about two files in its worktree.
  It does not say that other repos, rooms or henchmen exist.
- **Notes are the owner's to pass on.** A henchman may leave notes for its
  owner in `.office/notes.md`. The office collects what is added there and
  shows it to the task's owner alone. **The office never moves what was
  written in one room into another by itself.** The owner passes a note on,
  one at a time; only then is it written to the other parts'
  `.office/inbox.md`, where it is presented as a proposal from another agent
  to be checked, not as an instruction. A task has a switch to pass notes on
  without asking; it is off by default and says who will be able to read
  them. A part whose room the owner can no longer access is left alone both
  ways: nothing is collected from it, written to it, or passed on from it.
- **The files are hostile.** The office opens the worktree and then `.office`
  without following links, checks where each descriptor points before it
  creates or opens anything below it, opens files without following links
  and without blocking, and leaves anything but a regular file alone. It
  never rewrites the henchman's notes file and never touches the clone; git
  is kept away by a `.gitignore` inside `.office`. A round that hangs is given
  up after a time limit.
- **Pull requests.** When the henchman of a finished part ends a turn and the
  part has no pull request, the office opens a draft from its branch as the
  owner, through the same path, checks and project credential as the
  one-click PR. If it cannot (no commits, uncommitted files, the owner lost
  the room) the part says why, and it is tried again when the henchman next
  ends a turn and at boot.
- **Pull requests naming each other.** A PR description is read by everyone
  who can read that repo on GitHub. By default a PR names only the other
  parts' PRs in **public** repos. Naming private repos is a per-task choice
  of the owner, off by default, and even then a private repo is never named
  in a public repo's PR. GitHub reports organisation-internal repos as
  private, so they are treated as private.

## Consequences

- With the defaults, two parts in private repos do not hear from each other
  and their pull requests do not name each other until the owner acts. That
  is the cost of D26/D27: the owner is the one who knows whether the people
  of one repo may read about the other. **The owner has been asked whether
  the default for naming private repos should stay off.**
- The queue calls a part done when its henchman goes idle after working, as
  for any queued task. A part that stopped to ask a question is therefore
  "done" early; with commits it gets its draft pull request then, without
  commits it gets it when they arrive.
- The parts are not started together and are not held for each other; a part
  can finish before another has a desk.
- The viewer's linked tasks are fetched, so a change in another room shows up
  within 15 seconds instead of at once.

## Proposed spec wording

§5, after `tasks`: "`linked_tasks`: `title`, `createdBy`, `releaseNotes`,
`namePrivateRepos`; a `tasks` row with `linkedTaskId` is one part of it.
`linked_task_notes`: `linkedTaskId`, `taskId`, `body`, `releasedAt?`."

§9.4, Task queue: "A task may also name other rooms on the same level where
its owner may work: each room gets a part with its own henchman, worktree and
draft pull request, and the queue shows them as one task with one combined
state. A viewer sees only the parts in rooms open to them, and with one such
part an ordinary task. Henchmen leave notes for the owner, who alone reads
them and decides which to pass on to the other parts."

D7: replace "(#257)" with "(#257, ADR 0011)".
