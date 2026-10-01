# 0006: The compound scene, room presence and migrated seats

## Context

With the compound (SPEC §9, D21; #186) the office is one walkable lair instead
of floors behind an elevator. The client must draw every room, corridor and
door, follow the player with a rotatable 3/4 camera, and show live robots,
boards and laptop screens in the rooms near the player, within the SPEC §11
budget (60 fps on a 2020 iGPU at 1080p with 20 robots on screen). Robots on
floors migrated from the old templates must stay on their seats.

## Decision

- **One scene, few draws.** Rooms and corridors are lair kit pieces (#183) in
  compound metres, merged into one `PieceSet`: one instanced mesh per piece
  type for the whole compound, rebuilt only when the set of visible rooms or
  corridor chunks changes (culled against the camera frustum 4×/s). Free
  desks' laptops are kit pieces too; only robots' desks get the live laptop.
- **Presence.** The BuildingRoom carries positions anywhere in the compound
  (compound metres); `floor.go` tells it the room the player is in. The client
  joins the FloorRoom of that room plus up to three of the nearest rooms on
  screen that the viewer may see into, with a short linger so walking and
  turning do not churn joins. Floor commands and FloorRoom messages follow the
  room the player is in; the HUD's floor store mirrors only that room.
- **Rooms not joined** draw their furniture, kit laptops and static wall looks
  but no robots: without their FloorRoom the client does not know which seats
  are taken, and placeholders at guessed seats would be wrong. Their door
  plaques carry the published working/waiting counts instead. Rooms the viewer
  may not enter draw only their shell, a shut door and a rock cap, so the
  interior stays private (SPEC §9.1).
- **Seats.** Migration 0017 renames pre-compound seat ids in `desks` and
  `agents` through `LEGACY_SEAT_IDS` once, adds the desk rows of the generated
  seats a floor gains, and switches those floors to `layout_template_id =
  room`. New floors are created as generated rooms. There is one seat id space
  from then on, so neither the server, the scene nor the e2e suite resolves
  legacy ids at runtime. The SQL is generated from the map and a test keeps
  the committed migration in step with it.
- **Keys.** SPEC §9.2 binds both "rotate with Q/E" and "E interacts". `Q`
  turns the camera left; `E` interacts when something is in reach (a desk,
  laptop, board, clipboard, gong) and otherwise turns the camera right.

## Consequences

- The whole compound costs a bounded number of draw calls however many rooms
  it has; triangles grow with what is on screen, which culling bounds.
- A client is in at most four FloorRooms; their state stays bounded no matter
  how big the compound grows.
- Templates and `LEGACY_SEAT_IDS` stay for the migration and its tests only.
