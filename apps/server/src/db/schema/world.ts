/**
 * In-world objects (SPEC §5, §9.4): wall decor, whiteboards, jukebox.
 * Binary uploads live on disk (SPEC §4.2); only the Yjs document is a blob.
 */
import { DECOR_KINDS, JUKEBOX_SOURCES } from "@regulus/protocol";
import {
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestamps } from "./_columns.ts";
import { operations } from "./operations.ts";
import { users } from "./users.ts";

/** Pictures, posters and plants placed on wall anchors. `operationId` null = lobby. */
export const decor = sqliteTable(
  "decor",
  {
    id: id(),
    operationId: text("operation_id").references(() => operations.id, { onDelete: "cascade" }),
    kind: enumText("kind", DECOR_KINDS).notNull(),
    /** Wall anchor id from the operation layout template. */
    wallId: text("wall_id").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    w: real("w").notNull(),
    h: real("h").notNull(),
    /** Path of the uploaded image under the data dir; null for kinds without an image. */
    blobPath: text("blob_path"),
    placedBy: text("placed_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("decor_operation_id_idx").on(t.operationId),
    check("decor_kind_check", inEnum("kind", DECOR_KINDS)),
  ],
);

/** One Excalidraw/Yjs board per operation plus the building-wide one (`operationId` null). */
export const whiteboards = sqliteTable(
  "whiteboards",
  {
    id: id(),
    operationId: text("operation_id").references(() => operations.id, { onDelete: "cascade" }),
    /** Encoded Yjs document state (`Y.encodeStateAsUpdate`). */
    ydocBlob: blob("ydoc_blob", { mode: "buffer" }),
    /** Path of the latest PNG snapshot on disk, rendered for the wall texture. */
    snapshotPng: text("snapshot_png"),
    version: integer("version").notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("whiteboards_operation_id_unique").on(t.operationId)],
);

export const jukeboxTracks = sqliteTable(
  "jukebox_tracks",
  {
    id: id(),
    title: text("title").notNull(),
    artist: text("artist"),
    source: enumText("source", JUKEBOX_SOURCES).notNull(),
    /** File path (relative to the data dir), YouTube video id, or stream URL. */
    ref: text("ref").notNull(),
    durationMs: integer("duration_ms"),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    /** Licence note (e.g. `CC-BY-4.0`) so bundled tracks stay attributable. */
    license: text("license"),
    ...timestamps(),
  },
  (t) => [check("jukebox_tracks_source_check", inEnum("source", JUKEBOX_SOURCES))],
);

/** Playhead authority: a single row (the lobby jukebox), updated in place. */
export const jukeboxState = sqliteTable("jukebox_state", {
  id: id(),
  trackId: text("track_id").references(() => jukeboxTracks.id, { onDelete: "set null" }),
  /** Server clock (ms since epoch) at which the current track started. */
  startedAtServerMs: integer("started_at_server_ms"),
  /** Offset into the track (ms) at which playback was paused; null while playing. */
  pausedAtMs: integer("paused_at_ms"),
  volume: real("volume").notNull().default(0.5),
  /** `{ current, queue }`: the loaded entry and the waiting ones, next first (#47, jukebox/state-store.ts). */
  queueJson: jsonText("queue_json").notNull().default("[]"),
  ...timestamps(),
});
