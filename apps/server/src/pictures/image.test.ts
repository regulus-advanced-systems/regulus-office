/** Wall picture images (#46): magic bytes, sizes, and metadata dropped. */
import { describe, expect, test } from "bun:test";
import { inspectImage, sniffKind } from "./image.ts";
import { containsText, makeJpeg, makePng, makeWebp } from "./test-helpers.ts";

describe("magic bytes", () => {
  test("PNG, JPEG and WebP are recognised by their bytes; other formats are not", () => {
    expect(sniffKind(makePng())).toBe("png");
    expect(sniffKind(makeJpeg())).toBe("jpeg");
    expect(sniffKind(makeWebp())).toBe("webp");
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffKind(enc("GIF89a............"))).toBeNull();
    expect(sniffKind(enc("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffKind(enc("RIFF....WAVEfmt "))).toBeNull();
    expect(sniffKind(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffKind(new Uint8Array())).toBeNull();
  });

  test("a file that only starts like an image but does not parse is refused", () => {
    expect(inspectImage(makePng().subarray(0, 30))).toBeNull();
    // PNG whose first chunk is not IHDR.
    const png = makePng();
    png.set([0x74, 0x45, 0x58, 0x74], 12);
    expect(inspectImage(png)).toBeNull();
    // JPEG without a frame header before its scan.
    expect(inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0xff, 0xd9]))).toBeNull();
    // WebP whose RIFF size runs past the file.
    const webp = makeWebp();
    webp.set([0xff, 0xff, 0, 0], 4);
    expect(inspectImage(webp)).toBeNull();
    // A zero-sized image.
    expect(inspectImage(makePng(0, 4))).toBeNull();
  });
});

describe("sizes and metadata", () => {
  test("PNG: IHDR size; text chunks go, image chunks stay", () => {
    const out = inspectImage(makePng(640, 480));
    expect(out?.info).toEqual({ kind: "png", width: 640, height: 480 });
    const clean = out?.clean ?? new Uint8Array();
    expect(containsText(clean, "Somebody")).toBe(false);
    expect(containsText(clean, "IDAT")).toBe(true);
    expect(containsText(clean, "IEND")).toBe(true);
    expect(sniffKind(clean)).toBe("png");
  });

  test("JPEG: SOF size; EXIF and comments go, JFIF and the scan stay", () => {
    const out = inspectImage(makeJpeg(1024, 768));
    expect(out?.info).toEqual({ kind: "jpeg", width: 1024, height: 768 });
    const clean = out?.clean ?? new Uint8Array();
    expect(containsText(clean, "GPS")).toBe(false);
    expect(containsText(clean, "secret comment")).toBe(false);
    expect(containsText(clean, "JFIF")).toBe(true);
    expect([...clean.subarray(-4)]).toEqual([0x12, 0x34, 0xff, 0xd9]);
  });

  test("WebP: VP8X size; the EXIF chunk and its flag go; the RIFF size follows", () => {
    const out = inspectImage(makeWebp(300, 200));
    expect(out?.info).toEqual({ kind: "webp", width: 300, height: 200 });
    const clean = out?.clean ?? new Uint8Array();
    expect(containsText(clean, "camera")).toBe(false);
    expect(containsText(clean, "VP8L")).toBe(true);
    const view = new DataView(clean.buffer);
    expect(view.getUint32(4, true)).toBe(clean.length - 8);
    // VP8X flags byte (offset 20): EXIF bit cleared.
    expect((clean[20] ?? 0) & 0x08).toBe(0);
    expect(inspectImage(clean)?.info).toEqual({ kind: "webp", width: 300, height: 200 });
  });
});
