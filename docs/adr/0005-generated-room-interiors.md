# 0005: Generated room interiors and stable seat ids

> Since #226, floors are called operations and robots henchmen.

## Context

The compound (SPEC §9.1, D8, D21) replaces the three fixed floor templates with
rooms of any size from 4×4 to 12×12 tiles. A room starts vanilla (one desk of
four seats, a cabinet, a plant, a board wall and a lamp), room managers add
desks up to what the size fits and pick a lair decor style. Robots are bound
to seats by id (`desks.seat_id`, `agents.desk_seat_id`), so seat ids must
survive growth, and robots on migrated floors must keep their seats.

## Decision

- `generateRoom({width, depth, doorSide, deskCount, decorStyle})` in
  `packages/floor-layout/src/room/` returns a `FloorTemplate` (the shape the
  scene, nav grid and server already use) plus a `room` record (desks,
  materials, lighting, model ids). It is validated like the templates.
- Desks are four-seat pods on a fixed grid per size; desks fill the grid in a
  fixed order, so seat ids `d<desk>s<seat>` and their positions never change
  when desks are added. The capacity is the number of grid slots, less any
  that would leave under 75% of the interior free.
- Decor styles change palette, materials, lighting, model ids and which kind
  fills a decor site, never footprints, seats, anchors, the door or lanes.
- Migrated floors keep their old seat ids, with a legacy-id map
  (`LEGACY_SEAT_IDS`: template desk seats in order, four per desk) instead of
  rewriting rows, because the scene draws them from their template until
  #186. The migration gives them `ceil(seats / 4)` desks, so every old seat
  has a generated seat.
- Desk count changes are refused for rooms still on a template
  (`room_not_generated`): the template cannot draw added desks.

## Consequences

- #186 switches the scene to `generateRoom` and either renames migrated seat
  rows with the map or resolves them with `canonicalSeatId`, then sets
  `layoutTemplateId` to `room`.
- The settings service reads a room's size and door side from #181's
  placement columns (`floors.width`, `depth`, `door_side`); the door the
  generator cuts matches the compound's door (`doorStart`), and the wall
  facing it carries the boards.
- The art kit (#183) swaps models by the ids in `room.models`; function never
  depends on them.
