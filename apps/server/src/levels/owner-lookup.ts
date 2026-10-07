/**
 * What a level's owner is on GitHub (SPEC §14 D26; #268): an organisation or
 * a personal account, its numeric id and its display name. The migration and
 * the operation service only know the login a repo was added under, so a new
 * level starts as an unconfirmed `account` (no GitHub id). This asks GitHub
 * (`GET /users/{login}`, which answers for organisations too) and records the
 * answer.
 *
 * The call is made with the credential the office already uses for a repo on
 * that level (the office GitHub connection or the repo's own PAT, SPEC §8),
 * inside `withRepoCredential`, and only when there is one: a level whose
 * repos are all public and tokenless stays unconfirmed. Best effort: a
 * failure is logged and tried again at the next boot.
 * https://docs.github.com/en/rest/users/users#get-a-user
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { levels, operationRepos, operations } from "../db/schema/index.ts";
import type { GitHubCaller } from "../github/api.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import { type LevelRow, unconfirmedLevels } from "./store.ts";

export interface LevelOwnerLookupDeps {
  db: Db;
  repos: Pick<RepoAccess, "withRepoCredential">;
  api: GitHubCaller;
  logger: Logger;
  /** A level's kind or name changed: publish the levels again. */
  onChange?(): void;
}

interface RawOwner {
  id?: unknown;
  login?: unknown;
  type?: unknown;
  name?: unknown;
}

export class LevelOwnerLookup {
  readonly #deps: LevelOwnerLookupDeps;
  #running: Promise<number> | null = null;
  #again = false;

  constructor(deps: LevelOwnerLookupDeps) {
    this.#deps = deps;
  }

  /** Confirm every unconfirmed level; resolves to how many were confirmed. Never rejects. */
  run(): Promise<number> {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#run().finally(() => {
      this.#running = null;
      if (this.#again) {
        this.#again = false;
        void this.run();
      }
    });
    return this.#running;
  }

  async #run(): Promise<number> {
    let confirmed = 0;
    for (const level of unconfirmedLevels(this.#deps.db)) {
      try {
        if (await this.#confirm(level)) confirmed += 1;
      } catch (err) {
        this.#deps.logger.warn(
          { levelId: level.id, login: level.login, err: err instanceof Error ? err.message : "?" },
          "could not look up a level's owner on GitHub; it stays an unconfirmed account",
        );
      }
    }
    if (confirmed > 0) this.#deps.onChange?.();
    return confirmed;
  }

  async #confirm(level: LevelRow): Promise<boolean> {
    const { db, repos, api } = this.#deps;
    if (!level.login) return false;
    const repo = db
      .select({ id: operationRepos.id })
      .from(operationRepos)
      .innerJoin(operations, eq(operations.id, operationRepos.operationId))
      .where(eq(operations.levelId, level.id))
      .limit(1)
      .get();
    if (!repo) return false;
    const owner = await repos.withRepoCredential(repo.id, ({ token }) =>
      token
        ? api.json<RawOwner>({
            path: `/users/${encodeURIComponent(level.login ?? "")}`,
            bearer: token,
          })
        : null,
    );
    if (!owner || typeof owner.id !== "number" || !Number.isSafeInteger(owner.id)) return false;
    const name =
      typeof owner.name === "string" && owner.name.trim()
        ? owner.name.trim().slice(0, 100)
        : typeof owner.login === "string"
          ? owner.login.slice(0, 100)
          : level.name;
    db.update(levels)
      .set({ githubId: owner.id, kind: owner.type === "Organization" ? "org" : "account", name })
      .where(eq(levels.id, level.id))
      .run();
    this.#deps.logger.info(
      {
        levelId: level.id,
        login: level.login,
        kind: owner.type === "Organization" ? "org" : "account",
      },
      "level owner confirmed on GitHub",
    );
    return true;
  }
}
