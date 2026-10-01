import { describe, expect, test } from "bun:test";
import { mimeForFile, sniffAudio } from "./audio-sniff.ts";

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe("sniffAudio", () => {
  test.each([
    ["ID3 tagged MP3", bytes("ID3", [4, 0, 0, 0, 0, 0]), "mp3"],
    ["bare MPEG-1 layer III frame", bytes([0xff, 0xfb, 0x90, 0x64]), "mp3"],
    ["Ogg", bytes("OggS", [0, 2, 0, 0]), "ogg"],
    ["FLAC", bytes("fLaC", [0, 0, 0, 34]), "flac"],
    ["WAV", bytes("RIFF", [0x24, 0, 0, 0], "WAVE", "fmt "), "wav"],
    ["M4A", bytes([0, 0, 0, 0x20], "ftyp", "M4A ", [0, 0, 0, 0]), "m4a"],
    ["WebM", bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]), "webm"],
  ])("%s", (_, head, ext) => {
    expect(sniffAudio(head)?.ext).toBe(ext);
  });

  test.each([
    ["PNG", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])],
    ["HTML", bytes("<!doctype html>")],
    ["AVI in RIFF", bytes("RIFF", [0, 0, 0, 0], "AVI LIST")],
    ["AVIF in an MP4 box", bytes([0, 0, 0, 0x1c], "ftyp", "avif", [0, 0, 0, 0])],
    ["frame sync with a reserved version", bytes([0xff, 0xeb, 0x90, 0x64])],
    ["frame sync with a bad bitrate", bytes([0xff, 0xfb, 0xf0, 0x64])],
    ["too short", bytes("ID")],
  ])("refuses %s", (_, head) => {
    expect(sniffAudio(head)).toBeNull();
  });

  test("content types follow the stored extension", () => {
    expect(mimeForFile("/x/a.mp3")).toBe("audio/mpeg");
    expect(mimeForFile("/x/a.OGG")).toBe("audio/ogg");
    expect(mimeForFile("/x/a.exe")).toBe("application/octet-stream");
  });
});
