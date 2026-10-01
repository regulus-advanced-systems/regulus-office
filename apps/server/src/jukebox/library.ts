/**
 * The jukebox's track library (#47) on `jukebox_tracks`: the bundled
 * CC-BY tracks (seeded at boot from @regulus/assets), uploads stored under
 * `<dataDir>/jukebox/`, and YouTube videos (only their id; nothing is
 * fetched). `ref` says where a track's audio is: `bundled/<file>` for the
 * bundled set, `jukebox/<file>` (relative to the data dir) for uploads, the
 * video id for YouTube.
 */
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_AUDIO_DIR, BUNDLED_TRACKS, type BundledTrack } from "@regulus/assets";
import { JUKEBOX_LIMITS, type JukeboxSource, type JukeboxTrack } from "@regulus/protocol";
import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { jukeboxTracks, userProfiles } from "../db/schema/index.ts";

/** Sub-directory of the data dir that holds uploaded tracks. */
export const UPLOAD_DIR = "jukebox";
const BUNDLED_PREFIX = "bundled/";

type Row = typeof jukeboxTracks.$inferSelect;

export interface NewTrack {
  title: string;
  artist: string;
  source: JukeboxSource;
  ref: string;
  durationMs: number;
  addedBy: string;
}

export interface LibraryOptions {
  db: Db;
  dataDir: string;
  /** Where the bundled files are; the @regulus/assets copy by default. */
  bundledDir?: string;
  bundled?: readonly BundledTrack[];
}

export class JukeboxLibrary {
  readonly db: Db;
  readonly dataDir: string;
  readonly bundledDir: string;
  private readonly bundled: ReadonlyMap<string, BundledTrack>;

  constructor(options: LibraryOptions) {
    this.db = options.db;
    this.dataDir = resolve(options.dataDir);
    this.bundledDir = resolve(options.bundledDir ?? fileURLToPath(BUNDLED_AUDIO_DIR));
    this.bundled = new Map((options.bundled ?? BUNDLED_TRACKS).map((t) => [t.id, t]));
  }

  /** Insert or refresh the bundled tracks (titles and lengths follow the manifest). */
  seedBundled(): void {
    for (const t of this.bundled.values()) {
      const values = {
        title: t.title,
        artist: t.artist,
        source: "file" as const,
        ref: `${BUNDLED_PREFIX}${t.file}`,
        durationMs: t.durationMs,
        license: t.license,
      };
      this.db
        .insert(jukeboxTracks)
        .values({ id: t.id, ...values })
        .onConflictDoUpdate({ target: jukeboxTracks.id, set: values })
        .run();
    }
  }

  /** Every track: bundled first, then the rest in the order they were added. */
  list(): JukeboxTrack[] {
    const rows = this.db
      .select({ track: jukeboxTracks, name: userProfiles.displayName })
      .from(jukeboxTracks)
      .leftJoin(userProfiles, eq(userProfiles.userId, jukeboxTracks.addedBy))
      .orderBy(asc(jukeboxTracks.createdAt))
      .all();
    const tracks = rows.map((r) => this.toTrack(r.track, r.name ?? ""));
    return [...tracks.filter((t) => t.bundled), ...tracks.filter((t) => !t.bundled)];
  }

  get(id: string): JukeboxTrack | undefined {
    const row = this.db
      .select({ track: jukeboxTracks, name: userProfiles.displayName })
      .from(jukeboxTracks)
      .leftJoin(userProfiles, eq(userProfiles.userId, jukeboxTracks.addedBy))
      .where(eq(jukeboxTracks.id, id))
      .get();
    return row ? this.toTrack(row.track, row.name ?? "") : undefined;
  }

  add(track: NewTrack): JukeboxTrack {
    const row = this.db
      .insert(jukeboxTracks)
      .values({ ...track, artist: track.artist || null, durationMs: track.durationMs || null })
      .returning()
      .get();
    return this.get(row.id) as JukeboxTrack;
  }

  /** Uploads (file tracks outside the bundled set) this human has added. */
  uploadsBy(userId: string): number {
    const [row] = this.db
      .select({ n: count() })
      .from(jukeboxTracks)
      .where(and(eq(jukeboxTracks.addedBy, userId), eq(jukeboxTracks.source, "file")))
      .all();
    return row?.n ?? 0;
  }

  /** Record a measured length once (YouTube); false when it was known already or is out of range. */
  setDuration(id: string, durationMs: number): boolean {
    const track = this.get(id);
    if (!track || track.durationMs > 0) return false;
    if (durationMs < JUKEBOX_LIMITS.minDurationMs) return false;
    const ms = Math.min(Math.round(durationMs), JUKEBOX_LIMITS.maxYouTubeDurationMs);
    this.db.update(jukeboxTracks).set({ durationMs: ms }).where(eq(jukeboxTracks.id, id)).run();
    return true;
  }

  /**
   * Absolute path of a file track's audio, or null (YouTube, unknown, or a
   * `ref` that would leave its directory).
   */
  audioPath(id: string): string | null {
    const row = this.db.select().from(jukeboxTracks).where(eq(jukeboxTracks.id, id)).get();
    if (!row || row.source !== "file") return null;
    const bundled = row.ref.startsWith(BUNDLED_PREFIX);
    const base = bundled ? this.bundledDir : join(this.dataDir, UPLOAD_DIR);
    const path = resolve(
      base,
      bundled ? row.ref.slice(BUNDLED_PREFIX.length) : row.ref.slice(UPLOAD_DIR.length + 1),
    );
    return path.startsWith(base + sep) ? path : null;
  }

  private toTrack(row: Row, addedByName: string): JukeboxTrack {
    const bundled = this.bundled.get(row.id);
    return {
      id: row.id,
      title: row.title,
      artist: row.artist ?? "",
      source: row.source,
      videoId: row.source === "youtube" ? row.ref : "",
      durationMs: row.durationMs ?? 0,
      license: row.license ?? "",
      attribution: bundled?.attribution ?? "",
      bundled: bundled !== undefined,
      addedBy: row.addedBy ?? "",
      addedByName: row.addedBy ? addedByName.slice(0, 64) : "",
      createdAt: row.createdAt.getTime(),
    };
  }
}
