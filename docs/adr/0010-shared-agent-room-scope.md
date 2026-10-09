# 0010: What a shared agent may pass on, and how its memories carry rooms

Status: accepted (2026-10-09, #301). Builds on D20, D26, D34, D36.

## Context

A shared (office) agent reads the rooms its admins granted it. Rooms open to people by their own GitHub access (D26, D34), so the agent could read a room for someone who cannot see it, or repeat to one person what it learned while helping another, also later, through a memory. The owner decided that a shared agent cannot talk about a room to a person who has no access to it.

The office cannot read an answer and tell which room it is about, and it must not rely on the model to say so.

## Decision

The office works only with facts it has itself.

1. **Who a call is answered for.** Engines that run one turn at a time report whose message the agent is working on (`turn` event). A shared agent's tool call is answered for that person; with no turn known, for everyone waiting for its answer at once; with an access code, for the person who minted the code. The room access of a call is the lower of the agent's grant and that person's own access, asked from the one access gate at that moment. A closed room answers like one that does not exist.
2. **What a conversation has seen.** Every room a call handed the agent something of is recorded per agent and person (`office_agent_room_reads`), including rooms of memories it was given. The record only grows.
3. **Scope.** Whatever leaves a conversation for someone else carries those rooms: a memory or note (`room_scope`), a question to another person, a chat line. It reaches only people who can see every room in its scope. An entry outside a reader's access is not listed, counted or found.

Memories written by an engine outside a turn, and memories from before this change, take all rooms the agent is granted as their scope.

## Consequences

- No path depends on what the agent says a memory is about. The cost is breadth: a general remark saved in a conversation that had looked at a room is treated as being about that room, and stays so. A long conversation narrows who its memories reach. Where everyone sees the same rooms, nothing changes.
- Scopes hold operation ids without a foreign key, so an entry about a deleted or archived room stays closed to everyone instead of opening to all. Such entries still count towards the agent's cap.
- The office controls what it hands an agent, not what an engine keeps. The CLI session engine has one session per person, so nothing crosses between people there. An engine with a memory of its own across people (a Hermes the office runs) is seeded only with entries about no room, but what it remembers by itself is outside this.
- Personal agents are not affected: they act as their owner through the access gate and only their owner reads them.
