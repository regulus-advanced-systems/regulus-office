import { describe, expect, test } from "bun:test";
import { MOUSE_MODES, sgrWheel, splitMouseModes } from "./mouseModes.ts";

describe("mouse tracking is dropped so a drag selects (#164)", () => {
  test("Claude Code's requests (1000, 1002, 1003, 1006) are all mouse modes", () => {
    for (const mode of [1000, 1002, 1003, 1006]) expect(MOUSE_MODES.has(mode)).toBe(true);
    expect(splitMouseModes([1003])).toEqual({ mouse: [1003], rest: [] });
  });

  test("other modes in the same sequence are kept", () => {
    expect(splitMouseModes([1049, 1000, 25, [1006]])).toEqual({
      mouse: [1000, 1006],
      rest: [1049, 25],
    });
    expect(splitMouseModes([2004, 1])).toEqual({ mouse: [], rest: [2004, 1] });
    expect(splitMouseModes([])).toEqual({ mouse: [], rest: [] });
  });

  test("wheel reports for a controller: SGR button 64 up, 65 down, at a 1-based cell", () => {
    expect(sgrWheel(-120, 10.7, 3.2)).toBe("\x1b[<64;10;3M");
    expect(sgrWheel(40, 0, 0)).toBe("\x1b[<65;1;1M");
  });
});
