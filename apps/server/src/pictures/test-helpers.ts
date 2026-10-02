/**
 * Fixtures for the wall picture tests (#46): an office server with real auth
 * and the picture routes, operations and members in the database, the
 * published decor captured per operation, and tiny but well-formed images.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecorState, UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth/auth.ts";
import { cookieHeaderFrom, mountAuthRoutes } from "../auth/routes.ts";
import { PASSWORD, TEST_SECRET } from "../auth/test-helpers.ts";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { operationMembers, operations, userProfiles } from "../db/schema/index.ts";
import { createOfficeServer } from "../http/server.ts";
import { createLogger } from "../logging.ts";
import type { OperationDecorCommands } from "../rooms/operation/decor.ts";
import { createWallPictures } from "./index.ts";

export async function startPictureOffice() {
  const logger = createLogger({ level: "silent" });
  const dataDir = mkdtempSync(join(tmpdir(), "regulus-pictures-"));
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  const server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
    logger,
    version: "test",
  });
  const origin = new URL(server.url).origin;
  const auth = createAuth({
    db,
    logger,
    config: {
      betterAuthSecret: TEST_SECRET,
      publicUrl: String(server.url),
      githubOAuth: undefined,
      openSignup: true,
    },
  });
  mountAuthRoutes(server.router, auth);
  const published = new Map<string, DecorState[]>();
  let commands: OperationDecorCommands | undefined;
  const setup = createWallPictures({
    db,
    dataDir,
    logger,
    operations: {
      publishDecor: (operationId, decor) => published.set(operationId, [...decor]),
      setDecorCommands: (c) => {
        commands = c;
      },
    },
  });
  setup.mount(server.router, auth);

  let seq = 0;
  const signUp = async (name: string, role?: UserRole) => {
    seq += 1;
    const email = `${name.toLowerCase()}${seq}@example.com`;
    const res = await fetch(new URL("/api/auth/sign-up/email", server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`);
    const body = (await res.json()) as { user: { id: string } };
    const userRole = role ?? "member";
    db.update(userProfiles)
      .set({ role: userRole })
      .where(eq(userProfiles.userId, body.user.id))
      .run();
    return { id: body.user.id, role: userRole, cookie: cookieHeaderFrom(res.headers) };
  };

  /** A 4×4-tile room, door south, one desk: the vanilla room the tests hang pictures in. */
  const addOperation = (id: string, members: Record<string, "manage" | "spawn" | "view"> = {}) => {
    seq += 1;
    db.insert(operations)
      .values({
        id,
        name: id,
        slug: id,
        index: seq,
        paletteId: "p",
        layoutTemplateId: "t",
        width: 4,
        depth: 4,
        doorSide: "south",
      })
      .run();
    for (const [userId, access] of Object.entries(members)) {
      db.insert(operationMembers).values({ operationId: id, userId, access }).run();
    }
  };

  return {
    db,
    server,
    origin,
    dataDir,
    pictures: setup.pictures,
    published,
    commands: () => commands,
    signUp,
    addOperation,
    async stop() {
      await server.stop(true);
      db.$client.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export type PictureOffice = Awaited<ReturnType<typeof startPictureOffice>>;

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));

function pngChunk(type: string, data: number[]): number[] {
  // CRCs are not checked by the office (browsers do); zeros keep the fixture short.
  return [...u32be(data.length), ...bytes(type), ...data, 0, 0, 0, 0];
}

/** A PNG with an IHDR, a `tEXt` chunk (metadata), one IDAT and IEND. */
export function makePng(width = 2, height = 1, text = "Author\0Somebody"): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]),
    ...pngChunk("tEXt", bytes(text)),
    ...pngChunk("IDAT", [1, 2, 3]),
    ...pngChunk("IEND", []),
  ]);
}

function jpegSegment(marker: number, data: number[]): number[] {
  const len = data.length + 2;
  return [0xff, marker, (len >> 8) & 255, len & 255, ...data];
}

/** A JPEG with JFIF (APP0), EXIF (APP1, with a GPS-ish string), a comment, SOF0 and a scan. */
export function makeJpeg(width = 3, height = 2): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...jpegSegment(0xe0, [...bytes("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...jpegSegment(0xe1, [...bytes("Exif\0\0"), ...bytes("GPS 45.1N 13.6E")]),
    ...jpegSegment(0xfe, bytes("secret comment")),
    ...jpegSegment(0xc0, [
      8,
      (height >> 8) & 255,
      height & 255,
      (width >> 8) & 255,
      width & 255,
      1,
      1,
      0x11,
      0,
    ]),
    ...jpegSegment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);
}

function riffChunk(fourcc: string, data: number[]): number[] {
  return [...bytes(fourcc), ...u32le(data.length), ...data, ...(data.length % 2 ? [0] : [])];
}

/** A WebP (VP8X + EXIF + VP8L) with the EXIF flag set. */
export function makeWebp(width = 5, height = 4): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  const vp8x = [0x08, 0, 0, 0, w & 255, (w >> 8) & 255, 0, h & 255, (h >> 8) & 255, 0];
  const bits = (width - 1) | ((height - 1) << 14);
  const vp8l = [0x2f, ...u32le(bits), 0, 0];
  const body = [
    ...riffChunk("VP8X", vp8x),
    ...riffChunk("EXIF", bytes("Exif\0\0camera")),
    ...riffChunk("VP8L", vp8l),
  ];
  return new Uint8Array([...bytes("RIFF"), ...u32le(body.length + 4), ...bytes("WEBP"), ...body]);
}

/** Does `haystack` contain the ASCII `needle`? */
export function containsText(haystack: Uint8Array, needle: string): boolean {
  return new TextDecoder("latin1").decode(haystack).includes(needle);
}
