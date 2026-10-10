/**
 * The room's bookshelf (SPEC §10 M6 "a bookshelf of the repo's docs"; #264):
 * the Markdown files of the room's repo, read from the office's own mirror
 * at the default branch (SPEC §8, D17) and shown in a reader.
 *
 * A room's docs are its repo's contents, so every route answers only to a
 * person whose own GitHub access opens the room (D27, D34; `view` is enough)
 * and answers a closed room exactly as it answers no room: 404 `not_found`.
 *
 *   GET /api/operations/:operationId/docs               the shelf: every Markdown file
 *   GET /api/operations/:operationId/docs/file?path=    one document's Markdown source
 *   GET /api/operations/:operationId/docs/image?path=   a picture a document shows
 *   GET /api/operations/:operationId/docs/search?q=     lines that contain the text
 *
 * A path names a file inside the repo's tree and nothing else: the server
 * looks it up in the listing git gave it and reads the blob by its object
 * id, so no request ever becomes a filesystem path. {@link bookshelfPath}
 * is the one definition of a well-formed path, shared by server and web.
 */
import { z } from "zod";

export const BOOKSHELF_LIMITS = {
  /** Most documents a shelf lists; the rest are counted, not shown. */
  maxDocs: 500,
  /** Largest document the reader opens, bytes. */
  docMaxBytes: 512 * 1024,
  /** Largest picture a document may show, bytes. */
  imageMaxBytes: 5 * 1024 * 1024,
  /** Most pictures of one repo the office will serve. */
  maxImages: 5000,
  /** Longest path, characters. */
  pathMax: 1024,
  /** Search text length, and how many lines one search returns. */
  queryMin: 2,
  queryMax: 100,
  maxHits: 100,
  /** Longest line excerpt in a search hit, characters. */
  hitTextMax: 240,
} as const;

/** File name endings the shelf holds. */
export const BOOKSHELF_DOC_EXTENSIONS = [".md", ".markdown"] as const;
/** Pictures a document may show from its own repo (checked again by magic bytes). */
export const BOOKSHELF_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;

const endsWithAny = (path: string, endings: readonly string[]) => {
  const lower = path.toLowerCase();
  return endings.some((e) => lower.endsWith(e) && lower.length > e.length);
};

export const isBookshelfDocPath = (path: string) => endsWithAny(path, BOOKSHELF_DOC_EXTENSIONS);
export const isBookshelfImagePath = (path: string) => endsWithAny(path, BOOKSHELF_IMAGE_EXTENSIONS);

/**
 * `raw` as a path inside a repo's tree, or null: `/`-separated, relative,
 * no empty, `.` or `..` segment, no backslash, no control character, never
 * inside a `.git` directory.
 */
export function bookshelfPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > BOOKSHELF_LIMITS.pathMax)
    return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return null;
    if (segment.toLowerCase() === ".git") return null;
  }
  return raw;
}

export interface BookshelfLink {
  /** The file the link points at, as a path in the repo's tree. */
  path: string;
  /** The heading it points at (without `#`), or "". */
  anchor: string;
}

/**
 * Where a relative link or image in the document `from` points, in the
 * repo's tree: `../adr/0001.md#context` from `docs/guide/a.md` is
 * `docs/adr/0001.md` + `context`; a leading `/` starts at the repo root, as
 * on GitHub; `#heading` alone stays in `from`. Null for anything that is not
 * a relative path (a scheme, `//host`, a backslash) or that climbs out of
 * the repo.
 */
export function resolveBookshelfLink(from: string, target: string): BookshelfLink | null {
  const raw = target.trim();
  if (raw === "" || /[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith("//")) return null;
  const hash = raw.indexOf("#");
  const beforeHash = hash < 0 ? raw : raw.slice(0, hash);
  const query = beforeHash.indexOf("?");
  let file: string;
  let anchor: string;
  try {
    file = decodeURIComponent(query < 0 ? beforeHash : beforeHash.slice(0, query));
    anchor = hash < 0 ? "" : decodeURIComponent(raw.slice(hash + 1));
  } catch {
    return null;
  }
  if (file === "") return bookshelfPath(from) ? { path: from, anchor } : null;
  const stack = file.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const segment of file.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else stack.push(segment);
  }
  const path = bookshelfPath(stack.join("/"));
  return path ? { path, anchor } : null;
}

export const BookshelfDoc = z.object({
  path: z.string(),
  /** Size of the file, bytes. */
  size: z.number().int().nonnegative(),
  /** Over {@link BOOKSHELF_LIMITS.docMaxBytes}: listed, but the reader will not open it. */
  tooLarge: z.boolean(),
});
export type BookshelfDoc = z.infer<typeof BookshelfDoc>;

/** Why a shelf is empty: the room has no repo, or its mirror is not there (yet). */
export const BOOKSHELF_STATES = ["ready", "no_repo", "cloning", "unavailable"] as const;
export type BookshelfState = (typeof BOOKSHELF_STATES)[number];

export const BookshelfListing = z.object({
  state: z.enum(BOOKSHELF_STATES),
  /** `owner/name` of the repo and the branch the docs are read at. */
  repo: z.string(),
  branch: z.string(),
  /** Short id of the commit the listing was read at ("" when not ready). */
  commit: z.string(),
  /** README first, then the repo root, then `docs/`, then the rest. */
  docs: z.array(BookshelfDoc),
  /** Markdown files in the repo; more than `docs.length` when the shelf is full. */
  total: z.number().int().nonnegative(),
  /** When the office last fetched the mirror for this shelf, epoch ms; null if never. */
  fetchedAt: z.number().nullable(),
});
export type BookshelfListing = z.infer<typeof BookshelfListing>;

export const BookshelfDocument = z.object({
  path: z.string(),
  commit: z.string(),
  size: z.number().int().nonnegative(),
  /** The file as it is in the repo: untrusted Markdown, rendered only through the safe renderer. */
  markdown: z.string(),
});
export type BookshelfDocument = z.infer<typeof BookshelfDocument>;

export const BookshelfHit = z.object({
  path: z.string(),
  /** 1-based line number. */
  line: z.number().int().positive(),
  text: z.string(),
});
export type BookshelfHit = z.infer<typeof BookshelfHit>;

export const BookshelfSearchResponse = z.object({
  hits: z.array(BookshelfHit),
  /** More lines matched than {@link BOOKSHELF_LIMITS.maxHits}. */
  truncated: z.boolean(),
});
export type BookshelfSearchResponse = z.infer<typeof BookshelfSearchResponse>;

export const BOOKSHELF_ERRORS = [
  "not_found",
  "bad_path",
  "bad_query",
  "too_large",
  "not_text",
  "not_image",
  "unavailable",
] as const;
export type BookshelfError = (typeof BOOKSHELF_ERRORS)[number];

const base = (operationId: string) => `/api/operations/${encodeURIComponent(operationId)}/docs`;

export const bookshelfApiPath = (operationId: string) => base(operationId);
export const bookshelfDocApiPath = (operationId: string, path: string) =>
  `${base(operationId)}/file?path=${encodeURIComponent(path)}`;
export const bookshelfImageApiPath = (operationId: string, path: string) =>
  `${base(operationId)}/image?path=${encodeURIComponent(path)}`;
export const bookshelfSearchApiPath = (operationId: string, q: string) =>
  `${base(operationId)}/search?q=${encodeURIComponent(q)}`;
