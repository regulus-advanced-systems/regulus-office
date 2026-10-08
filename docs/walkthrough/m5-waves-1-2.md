# M5 walkthrough: waves 1 and 2

What to try, and what to look for, after upgrading the office to M5 waves 1
and 2 (SPEC §10 M5, D26–D37). It covers GitHub-based access and the lair's
levels, the new henchman look, names and bubbles, office agents (creating
them, their memory, seeing them in the world, the office PM at reception) and
connecting Hermes. Allow about an hour, and a colleague (or a second browser
in a private window, signed in as someone with different GitHub access) for
the access parts. Screenshots for each feature are in `docs/screenshots/<issue>/`.

Tick each box as you go; anything that looks wrong is worth an issue, with a
screenshot and what you did.

## 1. Upgrade (read this first: rooms start closed)

After this upgrade **every room is closed for everyone, you included, until
each person links their GitHub account**. Nothing is deleted and henchmen keep
running. Linking needs three settings, so check them before upgrading.

1. In `deploy/.env`: `OFFICE_MASTER_KEY` is set (it is, on an existing office),
   and `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set. On the GitHub app
   whose client id that is, add the callback URL
   `https://<office>/api/github/link/callback`. Without these nobody can open
   any room; the lobby then says linking is not set up.
2. Copy the newest file in `deploy/backups/` somewhere safe. Migrations 0020 to
   0027 run on your database; 0022 also splits any room that had several repos
   into one room per repo (named `<Original> / <repo>`) and sorts rooms onto
   levels. It moves no files on disk.
3. On the server: `scripts/setup.sh --upgrade`.
4. Sign in, press **Link** in the lobby panel "Rooms are closed", and approve on
   GitHub. Your levels and rooms appear once GitHub answers. Ask everyone else
   to do the same.
5. Optional, for instant permission updates instead of a 15-minute delay: on
   the office GitHub App add the organisation permission **Members: read** and
   the events member, membership, organization, repository and team
   (Settings → GitHub lists what is missing).

Look for:

- [ ] Every service healthy in `docker compose ps`.
- [ ] Before linking: the lobby only, the "Rooms are closed" panel, no levels in quick travel.
- [ ] After linking: your rooms are back, with their henchmen, boards and queue history.
- [ ] A room that had several repos is now several rooms; each kept its own henchmen and tasks; members were copied to each.
- [ ] Old GitHub sign-in tokens were blanked by the upgrade (they were stored unencrypted and unused); signing in with GitHub still works.

## 2. Access from GitHub (#267, #270, #244)

What you can see now comes from your own GitHub access: read lets you view a
room, write lets you work in it with your own henchmen, admin lets you manage
it. Being office owner or admin opens no room.

- [ ] Settings → You → **Your GitHub account**: the linked account, when it was last checked, the repos it opens, **Check now**, **Unlink**.
- [ ] A colleague with read access to one repo sees that room and can watch, but cannot spawn a henchman there.
- [ ] A room you have no GitHub access to is not listed anywhere: not in quick travel, search, boards, notifications or usage.
- [ ] Remove a colleague's access on GitHub (or have them unlink), press **Check now** as them: they are put out of the room with a plain message, their open terminal and whiteboard close, and the room is gone from their lists.
- [ ] Their henchman that was mid-task in that room finishes it; they cannot prompt it or start a new one.
- [ ] Add operation: the repo picker lists only repos your own account can see; the new room is usable at once.
- [ ] Operation settings: the members list is now called **Limits** and can only lower what GitHub gives.

## 3. Levels and the lift (#268, #269)

The lair has levels: the lobby, and one per GitHub organisation and personal
account that owns a room's repo.

- [ ] By the lobby's lift, press **E** (or click it): the panel lists the lobby and every level you can reach, with the organisation or account avatar. Levels where you can see nothing are not listed.
- [ ] Ride to a level: you arrive on its landing by the lift. Only that level is drawn.
- [ ] Quick travel (**F**) groups rooms by level; picking a room on another level takes you there.
- [ ] On someone else's level where you can see only some repos: the other rooms are sealed rock with a **NO ENTRY** plate. No name, no counts, no sound; walking in is refused with a plain message.
- [ ] Build mode works on the level you stand on; a sealed room's spot counts as taken.
- [ ] "Who's where" shows people on other levels you can reach as "On <level>".
- [ ] The jukebox, blast door and beach are on the lobby level only.

## 4. Henchmen: look, names, bubbles (#281, #256, #235, #283)

- [ ] Henchmen are slim and tall, bare-headed with different hair and skin tones, yellow jumpsuit with belt, gloves and boots, provider colour on collar and armbands, a light bar on each shoulder. Lab coat, black ops, chef and the PM suit match.
- [ ] Each henchman has a **name** above it that it keeps (after restart too). Names cannot be changed.
- [ ] Standing near a working henchman you see a small label of what it is doing ("reading auth.ts", "running tests"). Further away the labels fade; hovering one shows its label.
- [ ] A henchman waiting for you raises both arms under a yellow **waiting for you** bubble, at any distance. Clicking the bubble opens the request.
- [ ] A finished henchman holds one hand up under a teal **finished** bubble until you open its terminal or prompt it.
- [ ] A "needs you" desktop notice or toast has **Take me there**: it changes level and room and opens the request.
- [ ] Settings → Display → **Activity bubbles** off hides the small labels and keeps the yellow and teal ones.
- [ ] The button says **Send to barracks**.

## 5. Small fixes from the last walkthrough (#282)

- [ ] **New operation**: a **Room style** choice with previews (Control room, Laboratory, Workshop, War room, Armory). One repo per room.
- [ ] **First person**: opening any window (a board, a terminal, Settings) frees the mouse and stops the view turning; closing it returns to first person facing the same way.
- [ ] **Issue and PR boards**: wider columns; titles show in full over up to three lines.

## 6. Office agents: creating one (#271, #280)

Settings → **Agents**.

- [ ] **New agent…**: Name, Belongs to (me / the office), **Runs as**, **Runs on**, Model (cards marked Strong and Cheap, plus Other…), Job, What it may do, Appearance (gallery, the secretary among them), and its instructions.
- [ ] Create a personal agent **on DeepSeek** (Runs on: your DeepSeek key) and chat with it. This is the first run with a real key: check the reply arrives and Usage shows it.
- [ ] Create a shared agent (Belongs to: the office) on an office key; a colleague can chat with it, a view-only user cannot, and there is an hourly message limit per person (Settings → Agents → caps).
- [ ] **Change…** on a card edits the same fields; changing only the look does not restart it.
- [ ] A colleague cannot open your personal agent's chat. As admin you see its card and cost and can stop or remove it, nothing more.

## 7. What an agent is and remembers (#136)

On the agent's card.

- [ ] **Who it is and how it works**: edit, Preview, **History** with a diff and revert.
- [ ] **What it remembers** and **Notes**: ask the agent to remember something; it appears in the list; search, edit, delete.
- [ ] Pasting something that looks like a key is refused.
- [ ] Signed in as an admin who is not the owner: a personal agent's document, memories and notes cannot be opened.

Know this: that privacy is enforced by the office's screens and API. The
contents are plain text in the database, so whoever holds a backup or root on
the server can read them.

## 8. Agents in the world (#252, #60)

- [ ] Your personal agent stands beside you with the look you chose and follows you between rooms and levels (it arrives by the lift). Stand still after signing in: it comes to you, not to a corner.
- [ ] Click it or press **E**: its chat opens as a window. **Dismiss** sends it wandering; **Recall** brings it back. Sign out and in: it remembers.
- [ ] A colleague sees your agent ("<your name>'s assistant") and cannot open its chat.
- [ ] It waits at the door of a room you may not enter.
- [ ] A shared agent wanders the lobby and the rooms it was granted, pausing at boards and seats.
- [ ] When an agent has a question for you, it shows **waiting for you**; an unread reply shows **finished**.
- [ ] The **office PM** (a shared agent with the job Project manager) stands at the reception desk in the PM suit. **E** at the desk opens its chat even while it is away.
- [ ] Every quarter of an hour it walks a round through its granted rooms, stopping by the boards and beside waiting and finished henchmen. If your henchman is waiting and you are elsewhere, you get one notice with **Take me there**.

## 9. Your own Hermes in the office (#58)

Follow README → "Connect your own Hermes agent". In short: enable Hermes's API
server (`API_SERVER_ENABLED=true`, an `API_SERVER_KEY` of 16+ characters),
make it reachable from the office container (not `127.0.0.1`), then New agent…
→ Runs as **Connect my existing Hermes agent**.

- [ ] **Test connection** succeeds (if it says unreachable, read the Docker hint under it).
- [ ] Chat with it in the office; Telegram still answers as before.
- [ ] What you write under "Who it is and how it works" reaches it on the next message.
- [ ] Optional: make an access code on the card and add the shown block to Hermes's config so it can use office tools.
- [ ] Take the gateway down: the card shows Error with the reason, and recovers when it is back.

This has only ever run against a stand-in, so note anything that differs. The
office and Telegram are two conversations with one agent that shares its
memory; the field "Hermes session to continue" is experimental.

## 10. Hermes run by the office (#57, optional)

Follow README → "Hermes run by the office": build the image, set
`OFFICE_HERMES_IMAGE`, restart the office. Then New agent… → Runs as
**Hermes, run by the office**, on an Anthropic or DeepSeek key.

- [ ] The agent reaches Ready in about 15 seconds and answers a first message (never tried with a real key).
- [ ] Office tools work from its first message without any setup.

## Not in this round

The watchdog henchman (#253), Discord for the office PM (#258), moving a board
card to hand work to the PM (#254), the daily brief (#59), the conference room
(#137) and the council (#290), one task across several repos (#257).
