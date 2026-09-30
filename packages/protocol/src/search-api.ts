/**
 * Search across chat and persisted terminal scrollback (SPEC D10; issue #41).
 *
 *   GET /api/search?q=<query>          hits grouped by robot and floor
 *   GET /api/search/context?doc=<id>   scrollback lines around one hit
 *
 * The server sanitises the query (it never reaches SQLite FTS5 as syntax),
 * rate-limits it per user and returns only what the searcher may see:
 * chat from the lobby and from floors they can see, and the scrollback of
 * live robots whose terminal they may watch (D12). Snippets are structured
 * segments so the client never renders server text as HTML.
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";

export const SEARCH_API_PATH = "/api/search";
export const SEARCH_CONTEXT_API_PATH = "/api/search/context";

/** Longest query accepted (characters). */
export const SEARCH_QUERY_MAX = 200;
/** Most terms used from one query; the rest are ignored. */
export const SEARCH_TERMS_MAX = 8;

export const SEARCH_DOC_KINDS = ["chat", "scrollback"] as const;
export type SearchDocKind = (typeof SEARCH_DOC_KINDS)[number];

export const SnippetSegment = z.object({
  text: z.string(),
  /** This segment matched the query. */
  hit: z.boolean(),
});
export type SnippetSegment = z.infer<typeof SnippetSegment>;

export const SearchHit = z.object({
  docId: z.number().int().positive(),
  kind: z.enum(SEARCH_DOC_KINDS),
  /** Chat: when it was said. Scrollback: when that part of the screen was first indexed. */
  ts: TimestampMs,
  /** Chat: who said it. */
  author: z.string().optional(),
  snippet: z.array(SnippetSegment),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchGroup = z.object({
  /** `chat:<floorId>` or `robot:<agentId>`. */
  key: z.string(),
  kind: z.enum(SEARCH_DOC_KINDS),
  /** The lobby id for building-wide chat. */
  floorId: z.string(),
  floorName: z.string(),
  /** Scrollback groups: the robot, its desk and its owner. */
  agentId: Id.optional(),
  seatId: z.string().optional(),
  robotName: z.string().optional(),
  ownerName: z.string().optional(),
  hits: z.array(SearchHit),
});
export type SearchGroup = z.infer<typeof SearchGroup>;

export const SearchResponse = z.object({
  /** The words that were searched for (for highlighting and the terminal jump). */
  terms: z.array(z.string()),
  groups: z.array(SearchGroup),
  /** More hits matched than were returned. */
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const SearchContextResponse = z.object({
  docId: z.number().int().positive(),
  agentId: Id,
  floorId: Id,
  /** Scrollback lines around the hit, oldest first. */
  lines: z.array(z.string()),
  /** Index in `lines` of the first line that matched, or -1. */
  matchLine: z.number().int(),
});
export type SearchContextResponse = z.infer<typeof SearchContextResponse>;

export const SearchError = z.object({
  error: z.enum(["bad_query", "rate_limited", "not_found", "unauthorized"]),
  message: z.string().optional(),
});
export type SearchError = z.infer<typeof SearchError>;
