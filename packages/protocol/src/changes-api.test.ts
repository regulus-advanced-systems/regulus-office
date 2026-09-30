import { describe, expect, test } from "bun:test";
import {
  CommitChangesRequest,
  changesPath,
  isPreviewImagePath,
  sniffImageType,
} from "./changes-api.ts";

describe("changes API", () => {
  test("paths", () => {
    expect(changesPath("a1")).toBe("/api/agents/a1/changes");
    expect(changesPath("a/1", "commit")).toBe("/api/agents/a%2F1/changes/commit");
  });

  test("previews are raster images only, never SVG", () => {
    expect(isPreviewImagePath("a/b.PNG")).toBe(true);
    expect(isPreviewImagePath("x.webp")).toBe(true);
    expect(isPreviewImagePath("logo.svg")).toBe(false);
    expect(isPreviewImagePath("png")).toBe(false);
  });

  test("magic numbers decide the type, not the name", () => {
    const b = (...n: number[]) => new Uint8Array(n);
    expect(sniffImageType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(b(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(b(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(sniffImageType(b(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe(
      "image/webp",
    );
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageType(b())).toBeNull();
  });

  test("commit request: a message and at least one file", () => {
    expect(
      CommitChangesRequest.safeParse({ message: "  ", files: [{ path: "a", sig: null }] }).success,
    ).toBe(false);
    expect(CommitChangesRequest.safeParse({ message: "m", files: [] }).success).toBe(false);
    const ok = CommitChangesRequest.safeParse({ message: " m ", files: [{ path: "a", sig: "1" }] });
    expect(ok.success && ok.data.message).toBe("m");
  });
});
