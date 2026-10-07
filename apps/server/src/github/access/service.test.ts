/** A person's GitHub access snapshot (#267): linking, the mapping, changes, revocation. */
import { afterEach, describe, expect, test } from "bun:test";
import { operationAccessForRepoPermission } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { githubRepoPermissions, githubUserLinks } from "../../db/schema/index.ts";
import { type AccessFixture, accessFixture, CLIENT_SECRET } from "./fixture.ts";
import { LinkError } from "./service.ts";

let f: AccessFixture;
afterEach(() => f?.stop());

/** No token GitHub handed out, and not the client secret, anywhere in the database or the logs. */
function expectNoSecrets() {
  const haystack = `${f.dump()}\n${f.logs.join("\n")}`;
  expect(f.people.issued.length).toBeGreaterThan(0);
  for (const token of f.people.issued) expect(haystack).not.toContain(token);
  expect(haystack).not.toContain(CLIENT_SECRET);
}

describe("the snapshot", () => {
  test("without a link a person sees the lobby only", () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "owner");
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("none");
    expect(f.service.roomAccessFor(mia.id, f.repos.hello)).toBeNull();
    expect(f.service.levelsVisibleTo(mia.id)).toEqual([]);
    expect(f.service.status(mia.id)).toMatchObject({
      available: true,
      state: "not_linked",
      login: null,
      repos: [],
      organizations: [],
    });
  });

  test("linking takes the first snapshot from the person's own GitHub access", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");

    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("write");
    // The second room following the same GitHub repo gets the same answer.
    expect(f.service.repoPermissionFor(mia.id, f.repos.helloAgain)).toBe("write");
    expect(f.service.repoPermissionFor(mia.id, f.repos.secret)).toBe("none");
    expect(f.service.repoPermissionFor(mia.id, f.repos.notes)).toBe("admin");
    expect(f.service.roomAccessFor(mia.id, f.repos.hello)).toBe("spawn");
    expect(f.service.roomAccessFor(mia.id, f.repos.notes)).toBe("manage");
    expect(f.service.roomAccessFor(mia.id, f.repos.secret)).toBeNull();
    expect(f.service.organizationsOf(mia.id)).toEqual(["octo"]);

    // One level per organisation or account with a visible repo; the hidden repo is not in it.
    expect(f.service.levelsVisibleTo(mia.id)).toEqual([
      { owner: "mia", key: "mia", repoIds: [f.repos.notes] },
      { owner: "octo", key: "octo", repoIds: [f.repos.hello, f.repos.helloAgain] },
    ]);

    const status = f.service.status(mia.id);
    expect(status).toMatchObject({ state: "linked", login: "mia", lastError: null });
    expect(status.lastCheckedAt).not.toBeNull();
    expect(status.repos.map((r) => [r.fullName, r.permission, r.access])).toEqual([
      ["mia/notes", "admin", "manage"],
      ["octo/hello", "write", "spawn"],
      ["Octo/Hello", "write", "spawn"],
    ]);
    // octo/hello and Octo/Hello are one GitHub repo: asked once.
    const repoCalls = f.gh.calls.filter((c) => c.path.toLowerCase() === "/repos/octo/hello");
    expect(repoCalls).toHaveLength(1);
    expect(f.changes).toEqual([
      {
        userId: mia.id,
        repoIds: [f.repos.hello, f.repos.helloAgain, f.repos.notes].sort(),
        reason: "refresh",
      },
    ]);
  });

  test("the token is stored encrypted, bound to its user, and never logged or returned", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    const ravi = f.addUser("Ravi", "member");
    await f.link(mia.id, "mia");
    await f.link(ravi.id, "ravi");
    expectNoSecrets();
    expect(JSON.stringify(f.service.status(mia.id))).not.toContain("ghu_");
    const row = (userId: string) =>
      f.db.select().from(githubUserLinks).where(eq(githubUserLinks.userId, userId)).get();
    expect(row(mia.id)?.encryptedToken).toBeString();

    // Mia's ciphertext copied onto Ravi's row does not decrypt: his link drops, hers is intact.
    f.db
      .update(githubUserLinks)
      .set({ encryptedToken: row(mia.id)?.encryptedToken })
      .where(eq(githubUserLinks.userId, ravi.id))
      .run();
    expect(await f.service.refreshUser(ravi.id)).toMatchObject({ state: "revoked" });
    expect(f.service.repoPermissionFor(ravi.id, f.repos.hello)).toBe("none");
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("write");
  });

  test("office roles give no view into repos (D27)", async () => {
    f = accessFixture();
    const owner = f.addUser("Olga", "owner");
    await f.link(owner.id, "olga");
    expect(f.service.status(owner.id)).toMatchObject({ state: "linked", repos: [] });
    expect(f.service.levelsVisibleTo(owner.id)).toEqual([]);
    for (const repoId of Object.values(f.repos)) {
      expect(f.service.repoPermissionFor(owner.id, repoId)).toBe("none");
    }
    expect(f.changes).toEqual([]);
  });

  test("every GitHub level maps to what the issue proposes", async () => {
    f = accessFixture();
    const ravi = f.addUser("Ravi", "member");
    await f.link(ravi.id, "ravi");
    const seen: [string, string | null][] = [];
    for (const level of ["none", "read", "triage", "write", "maintain", "admin"] as const) {
      f.people.setPermission("ravi", "octo/secret", level);
      await f.service.refreshUser(ravi.id);
      expect(f.service.repoPermissionFor(ravi.id, f.repos.secret)).toBe(level);
      expect(f.service.roomAccessFor(ravi.id, f.repos.secret)).toBe(
        operationAccessForRepoPermission(level),
      );
      seen.push([level, f.service.roomAccessFor(ravi.id, f.repos.secret)]);
    }
    expect(seen).toEqual([
      ["none", null],
      ["read", "view"],
      ["triage", "view"],
      ["write", "spawn"],
      ["maintain", "spawn"],
      ["admin", "manage"],
    ]);
  });
});

describe("staying current", () => {
  test("a permission change on GitHub reaches the snapshot and emits access-changed", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    f.changes.length = 0;

    // Nothing changed on GitHub: no event.
    expect(await f.service.refreshUser(mia.id)).toEqual({
      state: "refreshed",
      changed: [],
      error: null,
    });
    expect(f.changes).toEqual([]);

    // Lowered on one repo, removed from another, added to a third.
    f.people.setPermission("mia", "octo/hello", "read");
    f.people.setPermission("mia", "mia/notes", "none");
    f.people.setPermission("mia", "octo/secret", "maintain");
    const outcome = await f.service.refreshUser(mia.id);
    const all = [f.repos.hello, f.repos.helloAgain, f.repos.notes, f.repos.secret].sort();
    expect(outcome).toEqual({ state: "refreshed", changed: all, error: null });
    expect(f.changes).toEqual([{ userId: mia.id, repoIds: all, reason: "refresh" }]);
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("read");
    expect(f.service.repoPermissionFor(mia.id, f.repos.notes)).toBe("none");
    expect(f.service.repoPermissionFor(mia.id, f.repos.secret)).toBe("maintain");
    expect(f.service.levelsVisibleTo(mia.id).map((l) => l.key)).toEqual(["octo"]);
  });

  test("a handler sees the new permission when access-changed fires", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    const seen: string[] = [];
    f.service.events.on("access-changed", (e) => {
      for (const repoId of e.repoIds) seen.push(f.service.repoPermissionFor(e.userId, repoId));
    });
    f.people.setPermission("mia", "mia/notes", "none");
    await f.service.refreshUser(mia.id);
    expect(seen).toEqual(["none"]);
  });

  test("a refresh limited to some repos leaves the others alone", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    f.people.setPermission("mia", "octo/hello", "admin");
    f.people.setPermission("mia", "mia/notes", "read");
    f.gh.calls.length = 0;
    await f.service.refreshUser(mia.id, { repoIds: [f.repos.notes] });
    expect(f.service.repoPermissionFor(mia.id, f.repos.notes)).toBe("read");
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("write");
    expect(f.gh.calls.filter((c) => c.path.startsWith("/repos/")).map((c) => c.path)).toEqual([
      "/repos/mia/notes",
    ]);
  });

  test("a revoked token drops the snapshot to nothing until the person links again", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    f.changes.length = 0;

    f.people.revoke("mia");
    const lost = [f.repos.hello, f.repos.helloAgain, f.repos.notes].sort();
    expect(await f.service.refreshUser(mia.id)).toEqual({ state: "revoked", repoIds: lost });
    expect(f.changes).toEqual([{ userId: mia.id, repoIds: lost, reason: "revoked" }]);
    for (const repoId of Object.values(f.repos)) {
      expect(f.service.repoPermissionFor(mia.id, repoId)).toBe("none");
    }
    expect(f.service.levelsVisibleTo(mia.id)).toEqual([]);
    expect(f.service.organizationsOf(mia.id)).toEqual([]);
    expect(f.service.status(mia.id)).toMatchObject({ state: "revoked", login: "mia", repos: [] });
    const row = f.db.select().from(githubUserLinks).get();
    expect(row).toMatchObject({ status: "revoked", encryptedToken: null });
    expect(row?.encryptedRefreshToken).toBeNull();
    expect(f.db.select().from(githubRepoPermissions).all()).toEqual([]);
    expect(f.service.linkedUserIds()).toEqual([]);
    // A later pass does not ask GitHub for a revoked link.
    f.gh.calls.length = 0;
    expect(await f.service.refreshUser(mia.id)).toEqual({ state: "not_linked" });
    expect(f.gh.calls).toEqual([]);

    await f.link(mia.id, "mia");
    expect(f.service.status(mia.id)).toMatchObject({ state: "linked", lastError: null });
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("write");
    expectNoSecrets();
  });

  test("when GitHub cannot answer, what is known stays and nothing is emitted", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    f.changes.length = 0;

    f.gh.state.failAll = true;
    const down = await f.service.refreshUser(mia.id);
    expect(down).toMatchObject({ state: "refreshed", changed: [] });
    expect(f.service.status(mia.id)).toMatchObject({ state: "linked" });
    expect(f.service.status(mia.id).lastError).toContain("500");
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("write");
    f.gh.state.failAll = false;

    // A rate limit is a 403, and must not be read as "no access".
    f.people.flags.rateLimited = true;
    await f.service.refreshUser(mia.id);
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("write");
    expect(f.service.status(mia.id).lastError).toContain("rate limit");
    f.people.flags.rateLimited = false;

    expect(f.changes).toEqual([]);
    await f.service.refreshUser(mia.id);
    expect(f.service.status(mia.id).lastError).toBeNull();
  });

  test("organisations GitHub will not list do not stop the repo checks", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    f.people.flags.orgsForbidden = true;
    await f.link(mia.id, "mia");
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("write");
    expect(f.service.organizationsOf(mia.id)).toEqual([]);
    expect(f.service.status(mia.id).lastError).toContain("organisations");
  });

  test("an expired GitHub App user token is renewed with its refresh token", async () => {
    let now = Date.UTC(2026, 9, 7, 12);
    f = accessFixture({ expiresInSeconds: 8 * 3600, now: () => now });
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    expect(f.people.issued).toHaveLength(2);

    now += 9 * 3600_000;
    f.people.expire("mia");
    f.people.setPermission("mia", "octo/hello", "admin");
    expect(await f.service.refreshUser(mia.id)).toMatchObject({ state: "refreshed", error: null });
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("admin");
    expect(f.people.issued).toHaveLength(4);
    expectNoSecrets();

    // The refresh token is gone too (the person revoked the app): nothing is left.
    now += 9 * 3600_000;
    f.people.revoke("mia");
    expect(await f.service.refreshUser(mia.id)).toMatchObject({ state: "revoked" });
    expect(f.service.repoPermissionFor(mia.id, f.repos.hello)).toBe("none");
    expect(f.service.status(mia.id).state).toBe("revoked");
  });

  test("refreshAll checks everyone who is linked", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    const ravi = f.addUser("Ravi", "member");
    await f.link(mia.id, "mia");
    await f.link(ravi.id, "ravi");
    f.people.setPermission("mia", "octo/secret", "read");
    f.people.setPermission("ravi", "octo/hello", "none");
    await f.service.refreshAll();
    expect(f.service.repoPermissionFor(mia.id, f.repos.secret)).toBe("read");
    expect(f.service.repoPermissionFor(ravi.id, f.repos.hello)).toBe("none");
  });
});

describe("linking and unlinking", () => {
  test("one GitHub account links to one office user", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    const other = f.addUser("Mallory", "member");
    await f.link(mia.id, "mia");
    const err = await f.link(other.id, "mia").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkError);
    expect((err as LinkError).code).toBe("account_in_use");
    expect(f.service.status(other.id).state).toBe("not_linked");
    expect(f.service.repoPermissionFor(other.id, f.repos.hello)).toBe("none");
  });

  test("a bad code is refused and nothing is stored", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    const err = await f.service
      .completeLink(mia.id, "not-a-code", "https://office.example.com/cb")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkError);
    expect((err as LinkError).code).toBe("github_rejected");
    expect(f.db.select().from(githubUserLinks).all()).toEqual([]);
  });

  test("linking another account replaces what the first one could see", async () => {
    f = accessFixture();
    const user = f.addUser("Mia", "member");
    await f.link(user.id, "mia");
    await f.link(user.id, "ravi");
    expect(f.service.status(user.id)).toMatchObject({ state: "linked", login: "ravi" });
    expect(f.service.repoPermissionFor(user.id, f.repos.notes)).toBe("none");
    expect(f.service.repoPermissionFor(user.id, f.repos.hello)).toBe("read");
    expect(f.service.organizationsOf(user.id)).toEqual([]);
  });

  test("unlinking removes the token and the snapshot and emits access-changed", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    f.changes.length = 0;
    expect(await f.service.unlink(mia.id)).toBe(true);
    expect(f.changes).toEqual([
      {
        userId: mia.id,
        repoIds: [f.repos.hello, f.repos.helloAgain, f.repos.notes].sort(),
        reason: "unlinked",
      },
    ]);
    expect(f.db.select().from(githubUserLinks).all()).toEqual([]);
    expect(f.service.status(mia.id)).toMatchObject({ state: "not_linked", repos: [] });
    expect(await f.service.unlink(mia.id)).toBe(false);
  });

  test("without an OAuth client or a master key nobody can link", async () => {
    f = accessFixture({ oauth: false });
    const mia = f.addUser("Mia", "member");
    expect(f.service.status(mia.id)).toMatchObject({
      available: false,
      unavailableReason: "oauth_not_configured",
    });
    expect(() => f.service.authorizeUrl("s", "https://office.example.com/cb")).toThrow(LinkError);
    f.stop();
    f = accessFixture({ keyring: false });
    expect(f.service.status("nobody")).toMatchObject({
      available: false,
      unavailableReason: "master_key_required",
    });
  });

  test("deleting a room's repo or the user removes their snapshot rows", async () => {
    f = accessFixture();
    const mia = f.addUser("Mia", "member");
    await f.link(mia.id, "mia");
    f.db.$client.run("PRAGMA foreign_keys = ON");
    f.db.$client.run(`DELETE FROM operation_repos WHERE id = '${f.repos.notes}'`);
    expect(f.service.levelsVisibleTo(mia.id).map((l) => l.key)).toEqual(["octo"]);
    f.db.$client.run(`DELETE FROM users WHERE id = '${mia.id}'`);
    expect(f.db.select().from(githubUserLinks).all()).toEqual([]);
    expect(f.db.select().from(githubRepoPermissions).all()).toEqual([]);
  });
});
