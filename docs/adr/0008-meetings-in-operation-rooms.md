# 0008: Meetings happen at a desk pod of their operation's room

## Context

The meeting room (#50, SPEC §10 M3, D9) lets 2-5 henchmen work on one task
in a pattern. The issue predates the compound; a later comment pointed at
the compound's conference/war room. The spec lists the conference room as a
fixed special room for every project's status screens (M5 content), while
an operation's henchmen, their terminals and their worktrees belong to that
operation: only its members walk into its room and see its henchmen (§9.1
"Access", D12), the OperationRoom state carries henchmen per operation, and
worktrees live in each human's own area of the operation (D17).

## Decision

- **Where.** A meeting belongs to one operation and one of its repos and
  happens in that operation's room: its members take seats at one desk pod
  (one that fits them all when there is one), a hologram over the pod's table
  shows the pattern, the round, who has the floor and the token budget, and a
  sign over the room's door says a meeting is in session. Watching needs only
  access to the operation, like any henchman there. The conference room keeps
  its M5 role; it may later show a read-only card per meeting, filtered by
  what the viewer may see.
- **Who.** The starter spawns every member through the AgentManager, as
  themselves: their runner, their sandboxes, their credentials or office keys
  (SPEC §8). The members are the starter's henchmen, so the terminal ACL
  applies unchanged: only the starter controls them and the meeting; office
  owners/admins get the emergency stop only.
- **Worktree.** One worktree of the starter's own clone, named after the
  meeting, on an `office/meeting-…` branch (from the PR's branch for a review
  panel), shared by the members. Sharing never crosses humans (D17).
  `.meeting/` holds the turn notes and is ignored through the clone's
  `info/exclude`. A member going back to barracks never removes the shared worktree; the
  meeting removes it once its henchmen have left, keeping the branch.
- **Orchestration.** The agenda (who speaks when) follows from the pattern,
  the member count and the round budget (`planMeeting` in the protocol). The
  server runs it step by step, prompting members through the manager and
  ending a turn when the henchman went busy and rests again (or its notes are
  written), and stores every turn, so a restart resumes at the first
  unfinished step. The token budget is checked before every step and on every
  usage event.
- **Output.** The closing turn's work becomes a draft PR through the
  one-click PR path, a comment review on the reviewed PR with the repo's
  project credential, or notes only.

## Consequences

- A room needs as many free seats as the meeting has members.
- Henchmen do not walk to another room for a meeting; the in-room hologram
  and door sign are the meeting's place in the world.
- Members of one meeting share one worktree, so their turns within a step
  should not edit the same files at once; the prompts keep parallel turns
  (map, review, discuss) to their own slices or to notes.
