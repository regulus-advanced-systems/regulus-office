import { describe, expect, test } from "bun:test";
import { useDom } from "./dom.ts";
import { getFocusable } from "./focusTrap.ts";

useDom();

describe("getFocusable with radio groups", () => {
  test("a named radio group is one tab stop: its checked radio, else its first", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button id="a">a</button>
      <input type="radio" name="colour" id="r1" />
      <input type="radio" name="colour" id="r2" checked />
      <input type="radio" name="colour" id="r3" />
      <input type="radio" name="size" id="s1" />
      <input type="radio" name="size" id="s2" />
      <input type="radio" id="loose" />
      <button id="b">b</button>`;
    document.body.append(root);
    expect(getFocusable(root).map((el) => el.id)).toEqual(["a", "r2", "s1", "loose", "b"]);
    root.remove();
  });
});
