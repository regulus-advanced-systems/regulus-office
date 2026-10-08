/**
 * The access gate (SPEC D26, D27; #270): a room opens with the person's own
 * GitHub permission on its repo and with nothing else. These tests try the
 * ways around it: an office role, a member row, a stale or foreign snapshot
 * row, a revoked link, an archived room.
 */
import { describe, expect, test } from "bun:test";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import {
  githubRepoPermissions,
  githubUserLinks,
  levels,
  operationMembers,
  operations,
} from "../db/schema/index.ts";
import {
  seedGitHubLink,
  seedRepoPermission,
  seedRoomAccess,
  seedRoomRepo,
} from "../github/access/test-snapshot.ts";
import {
  accessibleArchivedOperations,
  accessibleOperations,
  archivedOperationAccessFor,
  decideOperationAccess,
  lairViewFor,
  operationAccessFor,
  operationIdsOfRepos,
} from "./access.ts";
import { testDb } from "./test-helpers.ts";

function office() {
  const { db, addUser } = testDb();
  const level = (id: string, login: string) =>
    db.insert(levels).values({ id, kind: "org", login, name: login, position: 1 }).run();
  level("lv-octo", "octo");
  level("lv-mia", "mia");
  let index = 0;
  const room = (id: string, levelId: string, repo: string | null) => {
    index += 1;
    db.insert(operations)
      .values({ id, name: id, slug: id, index, paletteId: "p", layoutTemplateId: "t", levelId })
      .run();
    return repo ? seedRoomRepo(db, id, repo) : null;
  };
  const repos = {
    a: room("room-a", "lv-mia", "mia/a") as string,
    b: room("room-b", "lv-mia", "mia/b") as string,
    c: room("room-c", "lv-octo", "octo/c") as string,
  };
  return {
    db,
    repos,
    room,
    owner: addUser("Olga", "owner"),
    admin: addUser("Ada", "admin"),
    guest: addUser("Gus", "member"),
    watcher: addUser("Wes", "viewer"),
  };
}

describe("decideOperationAccess", () => {
  const base = { role: "member" as const, linked: true, member: null };

  test("GitHub's permission maps to the room, and no permission means no room", () => {
    const of = (p: Parameters<typeof decideOperationAccess>[0]["repoPermissions"][number]) =>
      decideOperationAccess({ ...base, repoPermissions: [p] });
    expect(of("none")).toBeNull();
    expect(of("read")).toBe("view");
    expect(of("triage")).toBe("view");
    expect(of("write")).toBe("spawn");
    expect(of("maintain")).toBe("spawn");
    expect(of("admin")).toBe("manage");
  });

  test("an office role adds nothing; a viewer is capped at view", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(decideOperationAccess({ ...base, role, repoPermissions: ["none"] })).toBeNull();
      expect(decideOperationAccess({ ...base, role, repoPermissions: ["read"] })).toBe("view");
    }
    expect(decideOperationAccess({ ...base, role: "viewer", repoPermissions: ["admin"] })).toBe(
      "view",
    );
  });

  test("a member row never widens and can narrow", () => {
    expect(
      decideOperationAccess({ ...base, repoPermissions: ["none"], member: "manage" }),
    ).toBeNull();
    expect(decideOperationAccess({ ...base, repoPermissions: ["read"], member: "manage" })).toBe(
      "view",
    );
    expect(decideOperationAccess({ ...base, repoPermissions: ["admin"], member: "view" })).toBe(
      "view",
    );
  });

  test("without a link in force a stored permission opens nothing", () => {
    expect(
      decideOperationAccess({ ...base, linked: false, repoPermissions: ["admin"] }),
    ).toBeNull();
  });

  test("every repo of a room must be visible", () => {
    expect(decideOperationAccess({ ...base, repoPermissions: ["admin", "none"] })).toBeNull();
    expect(decideOperationAccess({ ...base, repoPermissions: ["admin", "read"] })).toBe("view");
  });

  test("a room without a repo keeps the rule it was made under", () => {
    const none = { linked: false, repoPermissions: [] };
    expect(decideOperationAccess({ ...none, role: "owner", member: null })).toBe("manage");
    expect(decideOperationAccess({ ...none, role: "member", member: null })).toBeNull();
    expect(decideOperationAccess({ ...none, role: "member", member: "spawn" })).toBe("spawn");
    expect(decideOperationAccess({ ...none, role: "viewer", member: "manage" })).toBe("view");
  });
});

describe("the gate against the database", () => {
  test("a guest with repo A sees A and nothing of B or C", () => {
    const o = office();
    seedRoomAccess(o.db, o.guest.id, "room-a", "write");
    expect(operationAccessFor(o.db, o.guest, "room-a")).toBe("spawn");
    expect(operationAccessFor(o.db, o.guest, "room-b")).toBeNull();
    expect(operationAccessFor(o.db, o.guest, "room-c")).toBeNull();
    expect([...accessibleOperations(o.db, o.guest)]).toEqual([["room-a", "spawn"]]);
    const view = lairViewFor(o.db, o.guest);
    expect([...view.rooms.keys()]).toEqual(["room-a"]);
    expect([...view.levels].sort()).toEqual([LOBBY_LEVEL_ID, "lv-mia"].sort());
    expect(view.linked).toBe(true);
  });

  test("the office owner and an admin get no room from their role", () => {
    const o = office();
    for (const boss of [o.owner, o.admin]) {
      for (const id of ["room-a", "room-b", "room-c"]) {
        expect(operationAccessFor(o.db, boss, id)).toBeNull();
      }
      expect(accessibleOperations(o.db, boss).size).toBe(0);
      expect([...lairViewFor(o.db, boss).levels]).toEqual([LOBBY_LEVEL_ID]);
      expect(lairViewFor(o.db, boss).linked).toBe(false);
    }
    // Linked, with access to C only: C and nothing else.
    seedRoomAccess(o.db, o.owner.id, "room-c", "read");
    expect([...accessibleOperations(o.db, o.owner)]).toEqual([["room-c", "view"]]);
  });

  test("a member row does not open a room, for anyone", () => {
    const o = office();
    for (const who of [o.guest, o.owner]) {
      o.db
        .insert(operationMembers)
        .values({ operationId: "room-b", userId: who.id, access: "manage" })
        .run();
      expect(operationAccessFor(o.db, who, "room-b")).toBeNull();
      // Not even with a link, as long as GitHub does not show them the repo.
      seedGitHubLink(o.db, who.id);
      expect(operationAccessFor(o.db, who, "room-b")).toBeNull();
    }
  });

  test("a member row narrows what GitHub gives", () => {
    const o = office();
    seedRoomAccess(o.db, o.guest.id, "room-a", "admin");
    expect(operationAccessFor(o.db, o.guest, "room-a")).toBe("manage");
    o.db
      .insert(operationMembers)
      .values({ operationId: "room-a", userId: o.guest.id, access: "view" })
      .run();
    expect(operationAccessFor(o.db, o.guest, "room-a")).toBe("view");
  });

  test("a permission row without a link in force opens nothing", () => {
    const o = office();
    // A row with no link at all (should never exist; it must not be trusted).
    seedRepoPermission(o.db, o.guest.id, o.repos.a, "admin");
    expect(operationAccessFor(o.db, o.guest, "room-a")).toBeNull();
    // A revoked link whose permission row was, wrongly, left behind.
    seedGitHubLink(o.db, o.guest.id);
    expect(operationAccessFor(o.db, o.guest, "room-a")).toBe("manage");
    o.db
      .update(githubUserLinks)
      .set({ status: "revoked" })
      .where(eq(githubUserLinks.userId, o.guest.id))
      .run();
    expect(operationAccessFor(o.db, o.guest, "room-a")).toBeNull();
    expect(lairViewFor(o.db, o.guest).rooms.size).toBe(0);
  });

  test("someone else's permission, or a permission on another repo, opens nothing", () => {
    const o = office();
    seedRoomAccess(o.db, o.guest.id, "room-a", "admin");
    seedGitHubLink(o.db, o.admin.id);
    expect(operationAccessFor(o.db, o.admin, "room-a")).toBeNull();
    expect(operationAccessFor(o.db, o.guest, "room-b")).toBeNull();
  });

  test("losing the permission closes the room and, with the last room, the level", () => {
    const o = office();
    seedRoomAccess(o.db, o.guest.id, "room-a", "read");
    seedRoomAccess(o.db, o.guest.id, "room-c", "read");
    expect([...lairViewFor(o.db, o.guest).levels].sort()).toEqual(
      [LOBBY_LEVEL_ID, "lv-mia", "lv-octo"].sort(),
    );
    o.db.delete(githubRepoPermissions).where(eq(githubRepoPermissions.repoId, o.repos.c)).run();
    expect(operationAccessFor(o.db, o.guest, "room-c")).toBeNull();
    expect([...lairViewFor(o.db, o.guest).levels].sort()).toEqual(
      [LOBBY_LEVEL_ID, "lv-mia"].sort(),
    );
  });

  test("an office viewer watches and no more", () => {
    const o = office();
    seedRoomAccess(o.db, o.watcher.id, "room-a", "admin");
    expect(operationAccessFor(o.db, o.watcher, "room-a")).toBe("view");
  });

  test("an archived room is closed to everyone; its list is the viewer's own", () => {
    const o = office();
    seedRoomAccess(o.db, o.owner.id, "room-a", "admin");
    o.db.update(operations).set({ archivedAt: new Date() }).run();
    expect(operationAccessFor(o.db, o.owner, "room-a")).toBeNull();
    expect(accessibleOperations(o.db, o.owner).size).toBe(0);
    expect(archivedOperationAccessFor(o.db, o.owner, "room-a")).toBe("manage");
    expect(archivedOperationAccessFor(o.db, o.owner, "room-b")).toBeNull();
    expect([...accessibleArchivedOperations(o.db, o.owner).keys()]).toEqual(["room-a"]);
    expect(accessibleArchivedOperations(o.db, o.admin).size).toBe(0);
  });

  test("a room without a repo follows the office role and member rows", () => {
    const o = office();
    o.room("room-old", "holding", null);
    expect(operationAccessFor(o.db, o.owner, "room-old")).toBe("manage");
    expect(operationAccessFor(o.db, o.guest, "room-old")).toBeNull();
    o.db
      .insert(operationMembers)
      .values({ operationId: "room-old", userId: o.guest.id, access: "spawn" })
      .run();
    expect(operationAccessFor(o.db, o.guest, "room-old")).toBe("spawn");
    // It gives no way into a room that has a repo.
    expect(operationAccessFor(o.db, o.owner, "room-a")).toBeNull();
  });

  test("unknown ids give nothing", () => {
    const o = office();
    expect(operationAccessFor(o.db, o.owner, "nope")).toBeNull();
    expect(operationAccessFor(o.db, o.owner, "lobby")).toBeNull();
    expect(operationIdsOfRepos(o.db, [])).toEqual([]);
    expect(operationIdsOfRepos(o.db, [o.repos.a, o.repos.c, "nope"]).sort()).toEqual([
      "room-a",
      "room-c",
    ]);
  });
});
