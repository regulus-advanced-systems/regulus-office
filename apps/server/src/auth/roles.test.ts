import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_GENIUS_LOOK } from "@regulus/protocol";
import { type Db, MEMORY_DB_PATH, openDatabase, runMigrations, schema } from "../db/index.ts";
import { AuthHttpError } from "./errors.ts";
import {
  assertCanAssignRole,
  assertCanInviteRole,
  displayNameFor,
  ensureProfile,
  getProfileByUserId,
  setUserRole,
} from "./roles.ts";

const DEFAULT_AVATAR = DEFAULT_GENIUS_LOOK;
const opened: Db[] = [];
const freshDb = () => {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  opened.push(db);
  return db;
};
afterEach(() => {
  for (const db of opened.splice(0)) db.$client.close();
});

const insertUser = (db: Db, name: string, email: string) =>
  db.insert(schema.users).values({ name, email }).returning().get() as { id: string };

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof AuthHttpError) return err.code;
    throw err;
  }
  return "ok";
};

describe("ensureProfile", () => {
  test("first profile is owner, the rest members; repeat calls are no-ops", () => {
    const db = freshDb();
    const a = insertUser(db, "A", "a@example.com");
    const b = insertUser(db, "", "b.long@example.com");
    expect(ensureProfile(db, { ...a, name: "A", email: "a@example.com" })).toEqual({
      profile: {
        userId: a.id,
        displayName: "A",
        role: "owner",
        avatar: DEFAULT_AVATAR,
        avatarChosen: false,
      },
      created: true,
    });
    expect(ensureProfile(db, { ...b, name: "", email: "b.long@example.com" }).profile).toEqual({
      userId: b.id,
      displayName: "b.long",
      role: "member",
      avatar: DEFAULT_AVATAR,
      avatarChosen: false,
    });
    expect(ensureProfile(db, { ...a, name: "Renamed", email: "a@example.com" })).toEqual({
      profile: {
        userId: a.id,
        displayName: "A",
        role: "owner",
        avatar: DEFAULT_AVATAR,
        avatarChosen: false,
      },
      created: false,
    });
    expect(getProfileByUserId(db, "nope")).toBeUndefined();
  });
});

describe("role rules", () => {
  const owner = { id: "o", role: "owner" } as const;
  const admin = { id: "a", role: "admin" } as const;
  const member = { id: "m", role: "member" } as const;

  test("assertCanAssignRole", () => {
    expect(code(() => assertCanAssignRole(member, admin, "viewer"))).toBe("forbidden");
    expect(code(() => assertCanAssignRole(admin, admin, "member"))).toBe("cannot_change_own_role");
    expect(code(() => assertCanAssignRole(admin, member, "owner"))).toBe("owner_required");
    expect(code(() => assertCanAssignRole(admin, owner, "member"))).toBe("owner_required");
    expect(code(() => assertCanAssignRole(admin, member, "admin"))).toBe("ok");
    expect(code(() => assertCanAssignRole(owner, admin, "owner"))).toBe("ok");
  });

  test("assertCanInviteRole", () => {
    expect(code(() => assertCanInviteRole(member, "member"))).toBe("forbidden");
    expect(code(() => assertCanInviteRole(admin, "owner"))).toBe("owner_required");
    expect(code(() => assertCanInviteRole(admin, "admin"))).toBe("ok");
    expect(code(() => assertCanInviteRole(owner, "owner"))).toBe("ok");
  });

  test("setUserRole updates, audits, and is a no-op when unchanged", () => {
    const db = freshDb();
    const o = insertUser(db, "O", "o@example.com");
    const t = insertUser(db, "T", "t@example.com");
    ensureProfile(db, { ...o, email: "o@example.com" });
    ensureProfile(db, { ...t, email: "t@example.com" });
    const actor = { id: o.id, role: "owner" } as const;
    expect(setUserRole(db, actor, t.id, "viewer")).toEqual({
      userId: t.id,
      previousRole: "member",
      role: "viewer",
    });
    expect(setUserRole(db, actor, t.id, "viewer").previousRole).toBe("viewer");
    const rows = db.select().from(schema.auditLog).all();
    expect(rows.filter((r) => r.action === "user.role_change")).toHaveLength(1);
    expect(code(() => setUserRole(db, actor, "missing", "admin"))).toBe("user_not_found");
  });
});

describe("displayNameFor", () => {
  test("trims the name and falls back to the email local part", () => {
    expect(displayNameFor({ name: "  Ante ", email: "x@y" })).toBe("Ante");
    expect(displayNameFor({ name: null, email: "ante@example.com" })).toBe("ante");
  });
});
