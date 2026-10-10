# 0010: What a shared agent may pass on, and how its memories carry rooms

Status: accepted (2026-10-09, #301; revised 2026-10-10 after review). Builds on D20, D26, D34, D36.

## Context

A shared (office) agent reads the rooms its admins granted it. Rooms open to people by their own GitHub access (D26, D34), so the agent could read a room for someone who cannot see it, or repeat to one person what it learned while helping another, also later, through a memory. The owner decided that a shared agent cannot talk about a room to a person who has no access to it.

The office cannot read an answer and tell which room it is about, and it must not rely on the model to say so.

## Decision

The office works only with facts it has itself.

1. **Who a call is answered for comes from the credential it is made with.** For each turn of a conversation the office mints a token bound to the person whose message it is; the engine hands it to the agent for that turn and it is revoked when the turn ends. A call with a turn's token is answered for that person; a call that arrives after its turn carries a token that no longer exists. A call with an access code is answered for the person who minted the code. A shared agent's call with the token of its engine run, outside any turn, is refused whatever it asks: a shared agent has no errand of its own. There is no fallback that guesses from who is waiting. The access of a call to a room is the lower of the agent's grant and that person's own access, asked from the one access gate at that moment. A closed room answers like one that does not exist.
2. **What a conversation has seen.** Every room a call handed the agent something of is recorded per agent and person (`office_agent_room_reads`), including rooms of memories it was given. The record only grows, until the conversation is started over.
3. **Scope.** Whatever leaves a conversation for someone else carries those rooms: a memory or note (`room_scope`), a question to another person, and everything written where the people of a room read it (a chat line, a comment on a card, a task's title and prompt, a henchman's prompt). It reaches only people who can see every room in its scope. Every tool is classified by where its text ends up (`TOOL_REACH`), and the check for a room's readers is made in the dispatcher, not in each tool.
4. **Closed means absent.** An entry outside a reader's access is not listed, counted or found. A note's title is unique among the notes its writer can see, and the caps count what the writer can see; a hard cap on rows behind that fails like any storage failure.
5. **Unknown rooms are closed to everyone.** A shared agent's memories and notes from before scopes existed, and any scope that does not parse, are kept in the database and shown to nobody.
6. **Starting over.** A person who loses a room their conversation had read gets a new session with the agent before their next message; the CLI's transcript of the old one is deleted. Anyone can do the same for their own conversation ("Start this conversation over"), which is the way out when the breadth of point 3 gets in the way: the office tells the person in their chat when the agent was refused for that reason.
7. **Acting for a person.** A shared agent acts (queues, spawns, stops) only for the person its call is answered for, while that person waits for its answer.
8. **Two notes with one title.** For a reader a title means, among the notes they can see: one written for them, else the one about the most rooms, else the most recently changed.

## Consequences

- No path depends on what the agent says a memory is about, or on when a call arrives. The cost is breadth: a general remark saved in a conversation that had looked at a room is treated as being about that room, and stays so. Where everyone sees the same rooms, nothing changes.
- After the upgrade a shared agent starts with none of its earlier memories.
- A room read is a tool call. What a person types into the chat is not recorded as a read, so a memory saved from a conversation that called no room tool is about no room.
- Scopes hold operation ids without a foreign key, so an entry about a deleted or archived room stays closed to everyone instead of opening to all.
- The office controls what it hands an agent, not what an engine keeps. The CLI session engine has one session per person and takes a token per turn. Hermes keeps a memory of its own across everyone it talks to, so a shared agent is not run on Hermes until that can be turned off or kept per person; personal agents on Hermes are unaffected.
- Personal agents are not affected: they act as their owner through the access gate and only their owner reads them.
