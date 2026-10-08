/**
 * `GET /api/compound` is per viewer (D26; #270): the levels a person reaches,
 * the rooms they may enter in full, the other rooms on those levels as closed
 * footprints, and nothing of a level they cannot reach. Office roles open
 * nothing; moving and checking follow the same view.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { seedGitHubLink, seedRoomMember } from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { createOperations } from "../operations/index.ts";
import { testDb } from "../operations/test-helpers.ts";
import { CompoundService } from "./service.ts";

const logger = createLogger({ level: "silent" });
const services: CompoundService[] = [];
afterAll(() => {
  for (const s of services) s.close();
});

/** An office with a running build phase; nothing to clone from (the clones fail, the rooms stand). */
function office(buildMs: number) {
  const { db, addUser } = testDb();
  const owner = addUser("Olga", "owner");
  seedGitHubLink(db, owner.id);
  const compound = new CompoundService({ db, logger, config: { buildMs, sizeTiles: 64 } });
  services.push(compound);
  compound.boot();
  const operations = createOperations({
    db,
    logger,
    config: { projectsDir: "/nonexistent/rg270/projects", githubRemoteBase: "file:///nonexistent" },
    keyring: undefined,
    placer: compound,
    onChange: (id) => compound.operationChanged(id),
  });
  return { db, addUser, owner, compound, operations };
}

describe("the layout is per viewer (#270)", () => {
  /** Two rooms on octo's level and one on acme's, all the owner's; a build phase that is running. */
  async function lair() {
    const o = office(60_000);
    const actor = { id: o.owner.id, role: "owner" as const };
    const spot = { gridX: 4, gridY: 4, width: 8, depth: 8, doorSide: "south" as const };
    const make = (name: string, repo: string, gridX: number) =>
      o.operations.service.create(
        actor,
        { name, tier: "small", repos: [{ repo }] },
        { ...spot, gridX },
        "admin",
      );
    const made = [
      make("Hello", "octo/hello", 4),
      make("Sibling", "octo/hello", 20),
      make("Rockets", "acme/rockets", 4),
    ];
    await Promise.all(made.map((m) => m.cloned));
    const [hello, sibling, rockets] = made.map((m) => m.operation) as [
      (typeof made)[number]["operation"],
      (typeof made)[number]["operation"],
      (typeof made)[number]["operation"],
    ];
    return { ...o, actor, hello, sibling, rockets };
  }

  test("an open room in full, a closed room as a footprint, an unreachable level absent", async () => {
    const o = await lair();
    const mia = o.addUser("Mia", "member");
    seedRoomMember(o.db, mia.id, o.hello.operationId, "view");
    const full = o.compound.layoutResponse(o.actor);
    const seen = o.compound.layoutResponse(mia);

    // Levels: the lobby and octo's; acme's level and its room are not in the answer.
    expect(seen.levels.map((l) => l.login)).toEqual(["", "octo"]);
    expect(seen.rooms.map((r) => r.operationId).sort()).toEqual(
      [o.hello.operationId, o.sibling.operationId].sort(),
    );
    expect(JSON.stringify(seen)).not.toContain(o.rockets.operationId);
    expect(JSON.stringify(seen)).not.toContain(o.rockets.levelId);
    expect(JSON.stringify(seen)).not.toContain("Rockets");

    // The room Mia may enter is what the owner sees of it.
    const byId = (list: typeof seen, id: string) => list.rooms.find((r) => r.operationId === id);
    const open = byId(seen, o.hello.operationId);
    expect(open).toEqual(byId(full, o.hello.operationId));
    expect(open).toMatchObject({ name: "Hello", buildState: "building", gridX: 4 });
    expect(open?.buildEndsAt).toBeGreaterThan(0);
    expect(open?.closed).toBeUndefined();

    // The other room on the level is a closed door: where it is, not what it is.
    const sibling = byId(full, o.sibling.operationId);
    expect(sibling).toMatchObject({ name: "Sibling", buildState: "building", gridX: 20 });
    const closed = byId(seen, o.sibling.operationId);
    expect(closed).toEqual({
      operationId: o.sibling.operationId,
      levelId: o.hello.levelId,
      gridX: 20,
      gridY: 4,
      width: 8,
      depth: 8,
      doorSide: "south",
      doorX: sibling?.doorX ?? -1,
      doorY: sibling?.doorY ?? -1,
      name: "",
      buildState: "ready",
      buildEndsAt: 0,
      closed: true,
    });
    expect(JSON.stringify(seen)).not.toContain("Sibling");
  });

  test("office roles and member rows open nothing: an admin without GitHub access gets the lobby", async () => {
    const o = await lair();
    const ada = o.addUser("Ada", "admin");
    const lobbyOnly = (who: { id: string; role: "admin" }) => {
      const seen = o.compound.layoutResponse(who);
      return [seen.levels.map((l) => l.levelId), seen.rooms];
    };
    // Not linked; then linked with no permission on any repo.
    expect(lobbyOnly({ id: ada.id, role: "admin" })).toEqual([[LOBBY_LEVEL_ID], []]);
    seedGitHubLink(o.db, ada.id);
    expect(lobbyOnly({ id: ada.id, role: "admin" })).toEqual([[LOBBY_LEVEL_ID], []]);
    // The lobby level's own layout is the same for everyone.
    const mine = o.compound.layoutResponse({ id: ada.id, role: "admin" });
    expect(mine.compound).toEqual(o.compound.layoutResponse(o.actor).compound);

    // A room they cannot see is not there to move, and its level is checked like an empty one.
    const spot = { gridX: 4, gridY: 4, width: 8, depth: 8, doorSide: "south" as const };
    const admin = { id: ada.id, role: "admin" as const };
    expect(() => o.compound.move(admin, o.hello.operationId, { ...spot, gridX: 40 })).toThrow(
      "operation_not_found",
    );
    expect(o.compound.snapshot().rooms.get(o.hello.operationId)?.gridX).toBe(4);
    expect(o.compound.check(o.actor, spot, undefined, o.hello.levelId).ok).toBe(false);
    expect(o.compound.check(admin, spot, undefined, o.hello.levelId).ok).toBe(true);

    // With read access to one repo: its level, its room, and they may move it.
    seedRoomMember(o.db, ada.id, o.rockets.operationId, "view");
    const seen = o.compound.layoutResponse(admin);
    expect(seen.levels.map((l) => l.login)).toEqual(["", "acme"]);
    expect(seen.rooms.map((r) => [r.name, r.closed])).toEqual([["Rockets", undefined]]);
    expect(o.compound.check(admin, spot, undefined, o.rockets.levelId).ok).toBe(false);
    expect(o.compound.move(admin, o.rockets.operationId, { ...spot, gridX: 40 })).toMatchObject({
      name: "Rockets",
      gridX: 40,
    });
  });
});
