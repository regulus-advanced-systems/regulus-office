/**
 * Operations (= projects), each with its one repo, and their members (SPEC §5,
 * §9.1; D7, D14, D26). An operation is one repo in one room, on the level of
 * the GitHub organisation or account that owns the repo; that level is
 * created with its first operation. A second repo is a second room.
 * Owners and admins create and archive operations; anyone with `manage` access
 * manages the operation's members and retries failed clones. Every change is
 * audited (without credential material) and reported through `onChange` so
 * the BuildingRoom operation list and the OperationRoom refresh.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  OfficeUserInfo,
  OperationAccess,
  OperationInfo,
  OperationMemberInfo,
  OperationRepoInfo,
  RoomPlacement,
} from "@regulus/protocol";
import {
  CreateOperationRequest,
  DEFAULT_DESK_COUNT,
  hasOperationAccess,
  MAX_REPOS_PER_OPERATION,
  ONE_REPO_PER_ROOM_MESSAGE,
  SEATS_PER_DESK,
} from "@regulus/protocol";
import {
  legacyDeskCount,
  paletteById,
  paletteForOperation,
  ROOM_LAYOUT_ID,
  roomDeskSeatIds,
  templateForTier,
} from "@regulus/room-layout";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { z } from "zod";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import type { RoomPlacer } from "../compound/service.ts";
import type { Db } from "../db/index.ts";
import {
  desks,
  operationMembers,
  operationRepos,
  operations,
  userProfiles,
} from "../db/schema/index.ts";
import type { RepoCredentialVault } from "../github/credentials.ts";
import { parseRepoRef, repoWebUrl } from "../github/repo-ref.ts";
import { ensureLevelFor } from "../levels/store.ts";
import {
  effectiveAccess,
  isOfficeManager,
  type OperationActor,
  operationAccessFor,
} from "./access.ts";
import type { RepoCloner } from "./cloner.ts";
import { takenDirNames } from "./dirs.ts";
import { operationInfo, repoInfo } from "./info.ts";
import { slugify, uniqueSlug } from "./naming.ts";
import { listOfficeUsers } from "./people.ts";

export type CreateOperationInput = z.output<typeof CreateOperationRequest>;

export interface OperationServiceDeps {
  db: Db;
  vault: RepoCredentialVault;
  cloner: RepoCloner;
  /** Clone root: repos go to `<projectsDir>/<operation-slug>/<repo>`. */
  projectsDir: string;
  /** Operation list or an operation's repos changed (create, archive, clone settled). */
  onChange?(operationId: string): void;
  /** A level was created for a repo owner (its first operation): time to ask GitHub what it is. */
  onLevelCreated?(levelId: string): void;
  /** A human's access to an operation was set or removed: their open connections are checked again (#244). */
  onAccessChange?(operationId: string, userId: string): void;
  /** Places new operations in the compound (#181); without it operations are created unplaced. */
  placer?: RoomPlacer;
}

type OperationRow = typeof operations.$inferSelect;

const notFound = () => new AuthHttpError(404, "operation_not_found");

export class OperationService {
  readonly #deps: OperationServiceDeps;

  constructor(deps: OperationServiceDeps) {
    this.#deps = deps;
  }

  get #db() {
    return this.#deps.db;
  }

  #info(row: OperationRow, access: OperationAccess): OperationInfo {
    return operationInfo(this.#db, row, access);
  }

  /** Throw 404 unless `actor` has at least `need` on the live operation. */
  #require(actor: OperationActor, operationId: string, need: OperationAccess): OperationRow {
    const access = operationAccessFor(this.#db, actor, operationId);
    if (!access) throw notFound();
    if (!hasOperationAccess(access, need)) throw forbidden(`operation_${need}_required`);
    const row = this.#db.select().from(operations).where(eq(operations.id, operationId)).get();
    if (!row) throw notFound();
    return row;
  }

  accessFor(actor: OperationActor, operationId: string): OperationAccess | null {
    return operationAccessFor(this.#db, actor, operationId);
  }

  /** Create an operation; `placement` is where to build its room (else the compound picks a spot). */
  create(
    actor: OperationActor,
    input: CreateOperationInput,
    placement?: RoomPlacement,
  ): { operation: OperationInfo; cloned: Promise<void> } {
    if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
    const [repoInput] = input.repos;
    if (!repoInput || input.repos.length > MAX_REPOS_PER_OPERATION) {
      throw new AuthHttpError(400, "one_repo_per_room", { message: ONE_REPO_PER_ROOM_MESSAGE });
    }
    const parsed = parseRepoRef(repoInput.repo);
    if (!parsed.ok) throw new AuthHttpError(400, parsed.error, { repo: 0 });
    const ref = parsed.ref;
    if (repoInput.token && !this.#deps.vault.available) {
      throw new AuthHttpError(400, "master_key_required");
    }
    if (input.paletteId && !paletteById(input.paletteId)) {
      throw new AuthHttpError(400, "unknown_palette");
    }
    // Every new operation is a generated room (#182, #186). A room placed in build mode (#187)
    // starts vanilla (D8: one desk; any size fits it) and grows through room settings;
    // an auto-placed one gets its tier's desks (its size is picked to fit them).
    const template = templateForTier(input.tier);
    const deskCount = placement ? DEFAULT_DESK_COUNT : (legacyDeskCount(template.id) ?? 1);
    const deskSeats = roomDeskSeatIds(deskCount);

    const created = this.#db.transaction(
      (tx) => {
        const [top] = tx
          .select({ n: max(operations.index) })
          .from(operations)
          .all();
        const index = (top?.n ?? 0) + 1;
        // The slug names the operation's directories; split rooms keep an older one (dirs.ts).
        const slug = uniqueSlug(slugify(input.name), takenDirNames(tx));
        const operationId = randomUUID();
        if (placement && !this.#deps.placer) throw new AuthHttpError(503, "compound_unavailable");
        // The room goes on its repo owner's level (D7, D26), created on first use.
        const level = ensureLevelFor(tx, ref.owner);
        const room = this.#deps.placer?.claim(
          tx,
          actor,
          operationId,
          placement,
          deskCount * SEATS_PER_DESK,
          level.levelId,
        );
        tx.insert(operations)
          .values({
            id: operationId,
            name: input.name,
            slug,
            index,
            paletteId: input.paletteId ?? paletteForOperation(index).id,
            layoutTemplateId: ROOM_LAYOUT_ID,
            ...room,
            deskCount,
            levelId: level.levelId,
          })
          .run();
        const repoId = randomUUID();
        tx.insert(operationRepos)
          .values({
            id: repoId,
            operationId,
            owner: ref.owner,
            name: ref.name,
            url: repoWebUrl(ref),
            workdir: join(this.#deps.projectsDir, slug, ref.name),
            isPrimary: true,
            cloneStatus: "cloning",
            encryptedCredential: repoInput.token
              ? this.#deps.vault.seal(repoId, repoInput.token)
              : null,
          })
          .run();
        if (deskSeats.length > 0) {
          tx.insert(desks)
            .values(deskSeats.map((seatId) => ({ operationId, seatId })))
            .run();
        }
        writeAudit(tx, {
          userId: actor.id,
          action: AUDIT_ACTIONS.operationCreate,
          targetKind: "operation",
          targetId: operationId,
          meta: {
            name: input.name,
            slug,
            tier: input.tier,
            layoutTemplateId: ROOM_LAYOUT_ID,
            deskCount,
            levelId: level.levelId,
            levelCreated: level.created,
            repos: [`${ref.owner}/${ref.name}`],
            reposWithCredential: repoInput.token ? 1 : 0,
          },
        });
        return { operationId, repoId, level };
      },
      { behavior: "immediate" },
    );

    this.#deps.onChange?.(created.operationId);
    if (created.level.created) this.#deps.onLevelCreated?.(created.level.levelId);
    const cloned = this.#deps.cloner.enqueue(created.repoId).then(() => undefined);
    const row = this.#db
      .select()
      .from(operations)
      .where(eq(operations.id, created.operationId))
      .get();
    if (!row) throw notFound();
    return { operation: this.#info(row, "manage"), cloned };
  }

  /** Live operations the actor can see, in elevator order. */
  list(actor: OperationActor): OperationInfo[] {
    const rows = this.#db
      .select({ operation: operations, access: operationMembers.access })
      .from(operations)
      .leftJoin(
        operationMembers,
        and(eq(operationMembers.operationId, operations.id), eq(operationMembers.userId, actor.id)),
      )
      .where(isNull(operations.archivedAt))
      .orderBy(asc(operations.index))
      .all();
    return rows.flatMap(({ operation, access }) => {
      const effective = effectiveAccess(actor.role, access ?? null);
      return effective ? [this.#info(operation, effective)] : [];
    });
  }

  get(actor: OperationActor, operationId: string): OperationInfo {
    const row = this.#require(actor, operationId, "view");
    return this.#info(row, operationAccessFor(this.#db, actor, operationId) ?? "view");
  }

  archive(actor: OperationActor, operationId: string): void {
    if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
    const row = this.#require(actor, operationId, "manage");
    this.#db.transaction((tx) => {
      tx.update(operations)
        .set({ archivedAt: new Date() })
        .where(eq(operations.id, operationId))
        .run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.operationArchive,
        targetKind: "operation",
        targetId: operationId,
        meta: { name: row.name, slug: row.slug },
      });
    });
    this.#deps.onChange?.(operationId);
  }

  members(actor: OperationActor, operationId: string): OperationMemberInfo[] {
    this.#require(actor, operationId, "manage");
    return this.#db
      .select({
        userId: operationMembers.userId,
        displayName: userProfiles.displayName,
        access: operationMembers.access,
      })
      .from(operationMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, operationMembers.userId))
      .where(eq(operationMembers.operationId, operationId))
      .orderBy(asc(userProfiles.displayName))
      .all();
  }

  /** Office people to pick from when granting access (anyone who manages an operation). */
  people(actor: OperationActor): OfficeUserInfo[] {
    return listOfficeUsers(this.#db, actor);
  }

  setMember(
    actor: OperationActor,
    operationId: string,
    userId: string,
    access: OperationAccess,
  ): void {
    this.#require(actor, operationId, "manage");
    const profile = this.#db
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get();
    if (!profile) throw new AuthHttpError(404, "user_not_found");
    this.#db.transaction((tx) => {
      tx.insert(operationMembers)
        .values({ operationId, userId, access })
        .onConflictDoUpdate({
          target: [operationMembers.operationId, operationMembers.userId],
          set: { access },
        })
        .run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.operationMemberSet,
        targetKind: "operation",
        targetId: operationId,
        meta: { memberUserId: userId, access },
      });
    });
    this.#deps.onAccessChange?.(operationId, userId);
  }

  removeMember(actor: OperationActor, operationId: string, userId: string): void {
    this.#require(actor, operationId, "manage");
    this.#db.transaction((tx) => {
      const removed = tx
        .delete(operationMembers)
        .where(
          and(eq(operationMembers.operationId, operationId), eq(operationMembers.userId, userId)),
        )
        .returning({ id: operationMembers.id })
        .all();
      if (removed.length === 0) throw new AuthHttpError(404, "member_not_found");
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.operationMemberRemove,
        targetKind: "operation",
        targetId: operationId,
        meta: { memberUserId: userId },
      });
    });
    this.#deps.onAccessChange?.(operationId, userId);
  }

  /** Retry a failed clone, optionally replacing the stored PAT. */
  retryClone(
    actor: OperationActor,
    operationId: string,
    repoId: string,
    token: string | undefined,
  ): { repo: OperationRepoInfo; cloned: Promise<void> } {
    this.#require(actor, operationId, "manage");
    const repo = this.#db
      .select()
      .from(operationRepos)
      .where(and(eq(operationRepos.id, repoId), eq(operationRepos.operationId, operationId)))
      .get();
    if (!repo) throw new AuthHttpError(404, "repo_not_found");
    if (repo.cloneStatus !== "error") throw new AuthHttpError(409, `repo_${repo.cloneStatus}`);
    if (token && !this.#deps.vault.available) throw new AuthHttpError(400, "master_key_required");
    this.#db.transaction((tx) => {
      tx.update(operationRepos)
        .set({
          cloneStatus: "cloning",
          cloneError: null,
          ...(token ? { encryptedCredential: this.#deps.vault.seal(repoId, token) } : {}),
        })
        .where(eq(operationRepos.id, repoId))
        .run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.operationRepoClone,
        targetKind: "operation_repo",
        targetId: repoId,
        meta: {
          operationId,
          repo: `${repo.owner}/${repo.name}`,
          credentialReplaced: Boolean(token),
        },
      });
    });
    this.#deps.onChange?.(operationId);
    const cloned = this.#deps.cloner.enqueue(repoId);
    const updated = this.#db
      .select()
      .from(operationRepos)
      .where(eq(operationRepos.id, repoId))
      .get();
    if (!updated) throw new AuthHttpError(404, "repo_not_found");
    return { repo: repoInfo(updated), cloned };
  }
}
