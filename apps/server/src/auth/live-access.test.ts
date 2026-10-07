/**
 * The live access registry (#244) on its own: which connections a change
 * reaches, what each verdict does, sessions and removed accounts from the
 * database, the sweep, and that an ended connection is asked nothing more.
 */
import { describe, expect, test } from "bun:test";
import { ACCESS_CLOSE_CODES, type UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { sessions, userProfiles, users } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import {
  type AccessSubjects,
  type AccessVerdict,
  dbAccessSubjects,
  LiveAccess,
  type LiveConnection,
  type SessionRef,
} from "./live-access.ts";

const logger = createLogger({ level: "silent" });

interface Fake extends LiveConnection {
  closed: { code: number; reason: string } | null;
  verdict: AccessVerdict | "throw";
  asked: UserRole[];
}

function fake(
  userId: string,
  operationId: string | null,
  session: SessionRef = "unchecked",
  role: UserRole = "member",
): Fake {
  const c: Fake = {
    kind: "test",
    user: { id: userId, role },
    session,
    operationId,
    closed: null,
    verdict: "keep",
    asked: [],
    check(now) {
      c.asked.push(now.role);
      if (c.verdict === "throw") throw new Error("rule broke");
      return c.verdict;
    },
    close(code, reason) {
      c.closed = { code, reason };
    },
  };
  return c;
}

const everyone: AccessSubjects = (id) => ({ id, role: "member" });

describe("LiveAccess", () => {
  test("a change reaches only the connections in its scope", () => {
    const live = new LiveAccess({ subjects: everyone, logger });
    const mineOnA = fake("u1", "a");
    const mineOnB = fake("u1", "b");
    const mineInLobby = fake("u1", null);
    const theirsOnA = fake("u2", "a");
    for (const c of [mineOnA, mineOnB, mineInLobby, theirsOnA]) live.register(c);

    expect(live.accessChanged({ userId: "u1", operationIds: ["a"] })).toEqual({
      checked: 1,
      ended: 0,
    });
    expect(mineOnA.asked).toHaveLength(1);
    expect(live.accessChanged({ operationIds: ["a"] }).checked).toBe(2);
    expect(live.accessChanged({ userId: "u1" }).checked).toBe(3);
    expect(live.accessChanged().checked).toBe(4);
    expect(mineOnB.asked).toHaveLength(2);
    expect(theirsOnA.asked).toHaveLength(2);
    // An office-wide connection is in no operation's scope.
    expect(mineInLobby.asked).toHaveLength(2);
  });

  test("revoked and changed close with their codes; kept ones stay", () => {
    const ended: string[] = [];
    const live = new LiveAccess({
      subjects: everyone,
      logger,
      onEnded: (c, why) => ended.push(`${c.user.id}:${why}`),
    });
    const gone = fake("u1", "a");
    const less = fake("u2", "a");
    const same = fake("u3", "a");
    for (const c of [gone, less, same]) live.register(c);
    gone.verdict = "revoked";
    less.verdict = "changed";

    expect(live.accessChanged({ operationIds: ["a"] })).toEqual({ checked: 3, ended: 2 });
    expect(gone.closed).toEqual({ code: ACCESS_CLOSE_CODES.revoked, reason: "access revoked" });
    expect(less.closed).toEqual({ code: ACCESS_CLOSE_CODES.changed, reason: "access changed" });
    expect(same.closed).toBeNull();
    expect(ended).toEqual(["u1:revoked", "u2:changed"]);
    // Ended connections are forgotten: nothing asks or closes them again.
    expect(live.count()).toBe(1);
    expect(live.accessChanged().checked).toBe(1);
    expect(gone.asked).toHaveLength(1);
  });

  test("a rule that throws ends the connection instead of leaving it open", () => {
    const live = new LiveAccess({ subjects: everyone, logger });
    const c = fake("u1", "a");
    c.verdict = "throw";
    live.register(c);
    expect(live.accessChanged().ended).toBe(1);
    expect(c.closed?.code).toBe(ACCESS_CLOSE_CODES.revoked);
  });

  test("a connection that throws on close does not stop the others", () => {
    const live = new LiveAccess({ subjects: everyone, logger });
    const broken = fake("u1", "a");
    broken.verdict = "revoked";
    broken.close = () => {
      throw new Error("already closed");
    };
    const next = fake("u1", "a");
    next.verdict = "revoked";
    live.register(broken);
    live.register(next);
    expect(live.accessChanged().ended).toBe(2);
    expect(next.closed?.code).toBe(ACCESS_CLOSE_CODES.revoked);
  });

  test("the rule is asked with the human's current role; no account means signed out", () => {
    const roles = new Map<string, UserRole | null>([["u1", "viewer"]]);
    const live = new LiveAccess({
      subjects: (id) => {
        const role = roles.get(id);
        return role ? { id, role } : null;
      },
      logger,
    });
    const c = fake("u1", "a", { id: "s1" });
    live.register(c);
    live.accessChanged();
    expect(c.asked).toEqual(["viewer"]);
    roles.set("u1", null);
    live.accessChanged();
    expect(c.closed).toEqual({ code: ACCESS_CLOSE_CODES.signedOut, reason: "signed out" });
    // The rule is not consulted for someone who is not there.
    expect(c.asked).toEqual(["viewer"]);
  });

  test("an unchecked connection (development header) is asked with its own user", () => {
    const live = new LiveAccess({ subjects: () => null, logger });
    const c = fake("dev", "a", "unchecked", "admin");
    live.register(c);
    expect(live.accessChanged().ended).toBe(0);
    expect(c.asked).toEqual(["admin"]);
  });

  test("end() closes without asking; release() stops tracking", () => {
    const live = new LiveAccess({ subjects: everyone, logger });
    const a = fake("u1", "a");
    const b = fake("u1", "b");
    live.register(a);
    const release = live.register(b);
    release();
    expect(live.end({ userId: "u1" }, "signedOut")).toBe(1);
    expect(a.closed?.code).toBe(ACCESS_CLOSE_CODES.signedOut);
    expect(a.asked).toHaveLength(0);
    expect(b.closed).toBeNull();
  });

  test("the sweep asks about everything until stopped", async () => {
    const live = new LiveAccess({ subjects: everyone, logger });
    const c = fake("u1", "a");
    live.register(c);
    const stop = live.startSweep(10);
    await Bun.sleep(60);
    c.verdict = "revoked";
    await Bun.sleep(60);
    stop();
    expect(c.closed?.code).toBe(ACCESS_CLOSE_CODES.revoked);
  });
});

describe("dbAccessSubjects", () => {
  const setup = () => {
    const db = openDatabase({ path: MEMORY_DB_PATH });
    runMigrations(db);
    db.insert(users).values({ id: "u1", name: "Uma", email: "u1@x.test" }).run();
    db.insert(userProfiles).values({ userId: "u1", displayName: "Uma", role: "member" }).run();
    const addSession = (id: string, expiresAt: number) =>
      db
        .insert(sessions)
        .values({ id, userId: "u1", token: `t-${id}`, expiresAt: new Date(expiresAt) })
        .run();
    return { db, addSession };
  };

  test("a live session resolves to the current role", () => {
    const { db, addSession } = setup();
    addSession("s1", 2000);
    const subjects = dbAccessSubjects(db, () => 1000);
    expect(subjects("u1", { id: "s1" })).toEqual({ id: "u1", role: "member" });
    db.update(userProfiles).set({ role: "viewer" }).where(eq(userProfiles.userId, "u1")).run();
    expect(subjects("u1", { id: "s1" })).toEqual({ id: "u1", role: "viewer" });
  });

  test("a deleted, expired or foreign session is signed out", () => {
    const { db, addSession } = setup();
    addSession("s1", 2000);
    addSession("old", 500);
    const subjects = dbAccessSubjects(db, () => 1000);
    expect(subjects("u1", { id: "old" })).toBeNull();
    expect(subjects("u1", { id: "nope" })).toBeNull();
    expect(subjects("someone-else", { id: "s1" })).toBeNull();
    db.delete(sessions).where(eq(sessions.id, "s1")).run();
    expect(subjects("u1", { id: "s1" })).toBeNull();
  });

  test("`any` needs one live session; a removed account has none", () => {
    const { db, addSession } = setup();
    const subjects = dbAccessSubjects(db, () => 1000);
    expect(subjects("u1", "any")).toBeNull();
    addSession("s1", 2000);
    expect(subjects("u1", "any")).toEqual({ id: "u1", role: "member" });
    expect(subjects("u1", "unchecked")).toEqual({ id: "u1", role: "member" });
    db.delete(users).where(eq(users.id, "u1")).run();
    expect(subjects("u1", "any")).toBeNull();
    expect(subjects("u1", "unchecked")).toBeNull();
  });
});
