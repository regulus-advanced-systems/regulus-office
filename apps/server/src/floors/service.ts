/**
 * Floors (= projects) and their repos and members (SPEC §5, §9.1; D7, D14).
 * Owners and admins create and archive floors; anyone with `manage` access
 * manages the floor's members and retries failed clones. Every change is
 * audited (without credential material) and reported through `onChange` so
 * the BuildingRoom floor list and the FloorRoom refresh.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { paletteById, paletteForFloor, templateForTier } from "@regulus/floor-layout";
import type {
  FloorAccess,
  FloorInfo,
  FloorMemberInfo,
  FloorRepoInfo,
  OfficeUserInfo,
  RoomPlacement,
} from "@regulus/protocol";
import { CreateFloorRequest, hasFloorAccess } from "@regulus/protocol";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { z } from "zod";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import type { RoomPlacer } from "../compound/service.ts";
import type { Db } from "../db/index.ts";
import { desks, floorMembers, floorRepos, floors, userProfiles } from "../db/schema/index.ts";
import type { RepoCredentialVault } from "../github/credentials.ts";
import { parseRepoRef, type RepoRef, repoKey, repoWebUrl } from "../github/repo-ref.ts";
import { effectiveAccess, type FloorActor, floorAccessFor, isOfficeManager } from "./access.ts";
import type { RepoCloner } from "./cloner.ts";
import { floorInfo, repoInfo } from "./info.ts";
import { repoDirNames, slugify, uniqueSlug } from "./naming.ts";
import { listOfficeUsers } from "./people.ts";

export type CreateFloorInput = z.output<typeof CreateFloorRequest>;

export interface FloorServiceDeps {
  db: Db;
  vault: RepoCredentialVault;
  cloner: RepoCloner;
  /** Clone root: repos go to `<projectsDir>/<floor-slug>/<repo>`. */
  projectsDir: string;
  /** Floor list or a floor's repos changed (create, archive, clone settled). */
  onChange?(floorId: string): void;
  /** Places new floors in the compound (#181); without it floors are created unplaced. */
  placer?: RoomPlacer;
}

type FloorRow = typeof floors.$inferSelect;

const notFound = () => new AuthHttpError(404, "floor_not_found");

export class FloorService {
  readonly #deps: FloorServiceDeps;

  constructor(deps: FloorServiceDeps) {
    this.#deps = deps;
  }

  get #db() {
    return this.#deps.db;
  }

  #info(row: FloorRow, access: FloorAccess): FloorInfo {
    return floorInfo(this.#db, row, access);
  }

  /** Throw 404 unless `actor` has at least `need` on the live floor. */
  #require(actor: FloorActor, floorId: string, need: FloorAccess): FloorRow {
    const access = floorAccessFor(this.#db, actor, floorId);
    if (!access) throw notFound();
    if (!hasFloorAccess(access, need)) throw forbidden(`floor_${need}_required`);
    const row = this.#db.select().from(floors).where(eq(floors.id, floorId)).get();
    if (!row) throw notFound();
    return row;
  }

  accessFor(actor: FloorActor, floorId: string): FloorAccess | null {
    return floorAccessFor(this.#db, actor, floorId);
  }

  /** Create a floor; `placement` is where to build its room (else the compound picks a spot). */
  create(
    actor: FloorActor,
    input: CreateFloorInput,
    placement?: RoomPlacement,
  ): { floor: FloorInfo; cloned: Promise<void> } {
    if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
    const refs: RepoRef[] = input.repos.map((r, i) => {
      const parsed = parseRepoRef(r.repo);
      if (!parsed.ok) throw new AuthHttpError(400, parsed.error, { repo: i });
      return parsed.ref;
    });
    const keys = refs.map(repoKey);
    if (new Set(keys).size !== keys.length) throw new AuthHttpError(400, "duplicate_repo");
    if (input.repos.some((r) => r.token) && !this.#deps.vault.available) {
      throw new AuthHttpError(400, "master_key_required");
    }
    if (input.paletteId && !paletteById(input.paletteId)) {
      throw new AuthHttpError(400, "unknown_palette");
    }
    const template = templateForTier(input.tier);
    const deskSeats = template.seats.filter((s) => s.kind === "desk").map((s) => s.id);
    const dirNames = repoDirNames(refs);

    const created = this.#db.transaction(
      (tx) => {
        const [top] = tx
          .select({ n: max(floors.index) })
          .from(floors)
          .all();
        const index = (top?.n ?? 0) + 1;
        const taken = new Set(
          tx
            .select({ slug: floors.slug })
            .from(floors)
            .all()
            .map((r) => r.slug),
        );
        const slug = uniqueSlug(slugify(input.name), taken);
        const floorId = randomUUID();
        if (placement && !this.#deps.placer) throw new AuthHttpError(503, "compound_unavailable");
        const room = this.#deps.placer?.claim(tx, actor, floorId, placement, deskSeats.length);
        tx.insert(floors)
          .values({
            id: floorId,
            name: input.name,
            slug,
            index,
            paletteId: input.paletteId ?? paletteForFloor(index).id,
            layoutTemplateId: template.id,
            ...room,
          })
          .run();
        const repoIds = refs.map((ref, i) => {
          const repoId = randomUUID();
          const token = input.repos[i]?.token;
          tx.insert(floorRepos)
            .values({
              id: repoId,
              floorId,
              owner: ref.owner,
              name: ref.name,
              url: repoWebUrl(ref),
              workdir: join(this.#deps.projectsDir, slug, dirNames[i] ?? ref.name),
              isPrimary: i === 0,
              cloneStatus: "cloning",
              encryptedCredential: token ? this.#deps.vault.seal(repoId, token) : null,
            })
            .run();
          return repoId;
        });
        if (deskSeats.length > 0) {
          tx.insert(desks)
            .values(deskSeats.map((seatId) => ({ floorId, seatId })))
            .run();
        }
        writeAudit(tx, {
          userId: actor.id,
          action: AUDIT_ACTIONS.floorCreate,
          targetKind: "floor",
          targetId: floorId,
          meta: {
            name: input.name,
            slug,
            tier: input.tier,
            layoutTemplateId: template.id,
            repos: refs.map((r) => `${r.owner}/${r.name}`),
            reposWithCredential: input.repos.filter((r) => r.token).length,
          },
        });
        return { floorId, repoIds };
      },
      { behavior: "immediate" },
    );

    this.#deps.onChange?.(created.floorId);
    const cloned = Promise.all(created.repoIds.map((id) => this.#deps.cloner.enqueue(id))).then(
      () => undefined,
    );
    const row = this.#db.select().from(floors).where(eq(floors.id, created.floorId)).get();
    if (!row) throw notFound();
    return { floor: this.#info(row, "manage"), cloned };
  }

  /** Live floors the actor can see, in elevator order. */
  list(actor: FloorActor): FloorInfo[] {
    const rows = this.#db
      .select({ floor: floors, access: floorMembers.access })
      .from(floors)
      .leftJoin(
        floorMembers,
        and(eq(floorMembers.floorId, floors.id), eq(floorMembers.userId, actor.id)),
      )
      .where(isNull(floors.archivedAt))
      .orderBy(asc(floors.index))
      .all();
    return rows.flatMap(({ floor, access }) => {
      const effective = effectiveAccess(actor.role, access ?? null);
      return effective ? [this.#info(floor, effective)] : [];
    });
  }

  get(actor: FloorActor, floorId: string): FloorInfo {
    const row = this.#require(actor, floorId, "view");
    return this.#info(row, floorAccessFor(this.#db, actor, floorId) ?? "view");
  }

  archive(actor: FloorActor, floorId: string): void {
    if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
    const row = this.#require(actor, floorId, "manage");
    this.#db.transaction((tx) => {
      tx.update(floors).set({ archivedAt: new Date() }).where(eq(floors.id, floorId)).run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.floorArchive,
        targetKind: "floor",
        targetId: floorId,
        meta: { name: row.name, slug: row.slug },
      });
    });
    this.#deps.onChange?.(floorId);
  }

  members(actor: FloorActor, floorId: string): FloorMemberInfo[] {
    this.#require(actor, floorId, "manage");
    return this.#db
      .select({
        userId: floorMembers.userId,
        displayName: userProfiles.displayName,
        access: floorMembers.access,
      })
      .from(floorMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, floorMembers.userId))
      .where(eq(floorMembers.floorId, floorId))
      .orderBy(asc(userProfiles.displayName))
      .all();
  }

  /** Office people to pick from when granting access (anyone who manages a floor). */
  people(actor: FloorActor): OfficeUserInfo[] {
    return listOfficeUsers(this.#db, actor);
  }

  setMember(actor: FloorActor, floorId: string, userId: string, access: FloorAccess): void {
    this.#require(actor, floorId, "manage");
    const profile = this.#db
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get();
    if (!profile) throw new AuthHttpError(404, "user_not_found");
    this.#db.transaction((tx) => {
      tx.insert(floorMembers)
        .values({ floorId, userId, access })
        .onConflictDoUpdate({
          target: [floorMembers.floorId, floorMembers.userId],
          set: { access },
        })
        .run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.floorMemberSet,
        targetKind: "floor",
        targetId: floorId,
        meta: { memberUserId: userId, access },
      });
    });
  }

  removeMember(actor: FloorActor, floorId: string, userId: string): void {
    this.#require(actor, floorId, "manage");
    this.#db.transaction((tx) => {
      const removed = tx
        .delete(floorMembers)
        .where(and(eq(floorMembers.floorId, floorId), eq(floorMembers.userId, userId)))
        .returning({ id: floorMembers.id })
        .all();
      if (removed.length === 0) throw new AuthHttpError(404, "member_not_found");
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.floorMemberRemove,
        targetKind: "floor",
        targetId: floorId,
        meta: { memberUserId: userId },
      });
    });
  }

  /** Retry a failed clone, optionally replacing the stored PAT. */
  retryClone(
    actor: FloorActor,
    floorId: string,
    repoId: string,
    token: string | undefined,
  ): { repo: FloorRepoInfo; cloned: Promise<void> } {
    this.#require(actor, floorId, "manage");
    const repo = this.#db
      .select()
      .from(floorRepos)
      .where(and(eq(floorRepos.id, repoId), eq(floorRepos.floorId, floorId)))
      .get();
    if (!repo) throw new AuthHttpError(404, "repo_not_found");
    if (repo.cloneStatus !== "error") throw new AuthHttpError(409, `repo_${repo.cloneStatus}`);
    if (token && !this.#deps.vault.available) throw new AuthHttpError(400, "master_key_required");
    this.#db.transaction((tx) => {
      tx.update(floorRepos)
        .set({
          cloneStatus: "cloning",
          cloneError: null,
          ...(token ? { encryptedCredential: this.#deps.vault.seal(repoId, token) } : {}),
        })
        .where(eq(floorRepos.id, repoId))
        .run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.floorRepoClone,
        targetKind: "floor_repo",
        targetId: repoId,
        meta: { floorId, repo: `${repo.owner}/${repo.name}`, credentialReplaced: Boolean(token) },
      });
    });
    this.#deps.onChange?.(floorId);
    const cloned = this.#deps.cloner.enqueue(repoId);
    const updated = this.#db.select().from(floorRepos).where(eq(floorRepos.id, repoId)).get();
    if (!updated) throw new AuthHttpError(404, "repo_not_found");
    return { repo: repoInfo(updated), cloned };
  }
}
