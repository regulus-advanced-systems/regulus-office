/**
 * Search queries with the ACL applied in SQL (#41):
 *
 * - Chat lines: the lobby's (building-wide) for everyone signed in, a
 *   floor's only for people who can see that floor.
 * - Scrollback: only live robots on floors the searcher can see, i.e.
 *   exactly the people who may watch the robot's terminal (D12, the same
 *   `decideTerminalAccess(..., "watch", canViewFloor)` the bridge uses, which
 *   is checked again per robot before anything is returned). Exited robots
 *   cannot be watched, so their scrollback is not searchable either.
 *
 * Results come back in rank order, grouped by robot (scrollback) and by
 * floor (chat), with snippets as structured segments.
 */
import type { Database } from "bun:sqlite";
import {
  LOBBY_FLOOR_ID,
  type SearchContextResponse,
  type SearchDocKind,
  type SearchGroup,
  type SearchResponse,
  type SnippetSegment,
  type UserRole,
} from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import { decideTerminalAccess, type FloorVisibility } from "../terminals/acl.ts";
import type { ParsedQuery } from "./query.ts";

export interface SearchUser {
  id: string;
  role: UserRole;
}

/** Most hits returned per query, and per group. */
export const SEARCH_LIMIT = 60;
export const GROUP_LIMIT = 5;
export const LOBBY_NAME = "Lobby";

const HIT_OPEN = "\u0002";
const HIT_CLOSE = "\u0003";

interface HitRow {
  id: number;
  kind: SearchDocKind;
  source_id: string;
  floor_id: string;
  ts: number;
  author: string;
  snip: string;
}

interface RobotRow {
  owner_user_id: string;
  floor_id: string;
  desk_seat_id: string;
  task_title: string;
  model: string;
  owner_name: string | null;
}

/** FTS5 snippet text with HIT_OPEN/HIT_CLOSE markers → segments. */
export function snippetSegments(snip: string): SnippetSegment[] {
  const out: SnippetSegment[] = [];
  let hit = false;
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, hit });
    buf = "";
  };
  for (const ch of snip) {
    if (ch === HIT_OPEN || ch === HIT_CLOSE) {
      flush();
      hit = ch === HIT_OPEN;
    } else buf += ch;
  }
  flush();
  return out;
}

/**
 * The line of a chunk that best matches the query: the most distinct terms,
 * with the words in order (a phrase) winning outright; the first on a tie.
 */
export function bestLine(lines: readonly string[], terms: readonly string[]): number {
  const phrase = terms.join(" ");
  let best = 0;
  let bestScore = 0;
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    let score = terms.filter((t) => low.includes(t)).length;
    if (terms.length > 1 && low.includes(phrase)) score += terms.length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export class Searcher {
  readonly #client: Database;
  readonly #canViewFloor: FloorVisibility;

  constructor(opts: { db: Db; canViewFloor: FloorVisibility }) {
    this.#client = opts.db.$client;
    this.#canViewFloor = opts.canViewFloor;
  }

  /** Live floors the user can see, with their names. */
  visibleFloors(user: SearchUser): Map<string, string> {
    const rows = this.#client
      .query<{ id: string; name: string }, []>(
        "SELECT id, name FROM floors WHERE archived_at IS NULL",
      )
      .all();
    return new Map(rows.filter((r) => this.#canViewFloor(user, r.id)).map((r) => [r.id, r.name]));
  }

  #robot(agentId: string): RobotRow | null {
    return this.#client
      .query<RobotRow, [string]>(
        `SELECT a.owner_user_id, a.floor_id, a.desk_seat_id, a.task_title, a.model,
                p.display_name AS owner_name
         FROM agents a LEFT JOIN user_profiles p ON p.user_id = a.owner_user_id
         WHERE a.id = ? AND a.exited_at IS NULL`,
      )
      .get(agentId);
  }

  /** May `user` watch this robot's terminal (and so search its scrollback)? */
  #mayWatch(user: SearchUser, robot: RobotRow | null): robot is RobotRow {
    if (!robot) return false;
    const target = { ownerUserId: robot.owner_user_id, floorId: robot.floor_id };
    return decideTerminalAccess(user, target, "watch", this.#canViewFloor).ok;
  }

  search(user: SearchUser, query: ParsedQuery, limit: number = SEARCH_LIMIT): SearchResponse {
    const floors = this.visibleFloors(user);
    const floorIds = [...floors.keys()];
    const rows = this.#client
      .query<HitRow, [string, string, string, number]>(
        `SELECT d.id, d.kind, d.source_id, d.floor_id, d.ts, d.author,
                snippet(search_fts, 0, char(2), char(3), '…', 16) AS snip
         FROM search_fts
         JOIN search_docs d ON d.id = search_fts.rowid
         LEFT JOIN agents a ON d.kind = 'scrollback' AND a.id = d.source_id
         WHERE search_fts MATCH ?
           AND ((d.kind = 'chat' AND d.floor_id IN (SELECT value FROM json_each(?)))
             OR (d.kind = 'scrollback' AND a.id IS NOT NULL AND a.exited_at IS NULL
                 AND a.floor_id IN (SELECT value FROM json_each(?))))
         ORDER BY rank
         LIMIT ?`,
      )
      .all(
        query.match,
        JSON.stringify([LOBBY_FLOOR_ID, ...floorIds]),
        JSON.stringify(floorIds),
        limit + 1,
      );

    let truncated = rows.length > limit;
    const groups = new Map<string, SearchGroup>();
    const robots = new Map<string, RobotRow | null>();
    for (const row of rows.slice(0, limit)) {
      const key = row.kind === "chat" ? `chat:${row.floor_id}` : `robot:${row.source_id}`;
      let group = groups.get(key);
      if (!group) {
        if (row.kind === "chat") {
          const floorName = row.floor_id === LOBBY_FLOOR_ID ? LOBBY_NAME : floors.get(row.floor_id);
          if (floorName === undefined) continue;
          group = { key, kind: "chat", floorId: row.floor_id, floorName, hits: [] };
        } else {
          if (!robots.has(row.source_id)) robots.set(row.source_id, this.#robot(row.source_id));
          const robot = robots.get(row.source_id) ?? null;
          if (!this.#mayWatch(user, robot)) continue;
          group = {
            key,
            kind: "scrollback",
            floorId: robot.floor_id,
            floorName: floors.get(robot.floor_id) ?? robot.floor_id,
            agentId: row.source_id,
            seatId: robot.desk_seat_id,
            robotName: robot.task_title || robot.model,
            ownerName: robot.owner_name ?? "",
            hits: [],
          };
        }
        groups.set(key, group);
      }
      if (group.hits.length >= GROUP_LIMIT) {
        truncated = true;
        continue;
      }
      group.hits.push({
        docId: row.id,
        kind: row.kind,
        ts: row.ts,
        ...(row.kind === "chat" ? { author: row.author } : {}),
        snippet: snippetSegments(row.snip),
      });
    }
    return { terms: query.terms, groups: [...groups.values()], truncated };
  }

  /** Scrollback lines around one hit, or null when it is gone or not the user's to see. */
  context(user: SearchUser, docId: number, terms: readonly string[]): SearchContextResponse | null {
    const doc = this.#client
      .query<{ source_id: string; seq: number }, [number]>(
        "SELECT source_id, seq FROM search_docs WHERE id = ? AND kind = 'scrollback'",
      )
      .get(docId);
    if (!doc) return null;
    const robot = this.#robot(doc.source_id);
    if (!this.#mayWatch(user, robot)) return null;
    const chunks = this.#client
      .query<{ seq: number; body: string }, [string, number, number]>(
        `SELECT seq, body FROM search_docs
         WHERE kind = 'scrollback' AND source_id = ? AND seq BETWEEN ? AND ?
         ORDER BY seq`,
      )
      .all(doc.source_id, doc.seq - 2, doc.seq + 2);
    const lines: string[] = [];
    let matchLine = -1;
    const lowered = terms.map((t) => t.toLowerCase()).filter(Boolean);
    for (const chunk of chunks) {
      const chunkLines = chunk.body.split("\n");
      if (chunk.seq === doc.seq) {
        matchLine = lines.length + bestLine(chunkLines, lowered);
      }
      lines.push(...chunkLines);
    }
    return { docId, agentId: doc.source_id, floorId: robot.floor_id, lines, matchLine };
  }
}
