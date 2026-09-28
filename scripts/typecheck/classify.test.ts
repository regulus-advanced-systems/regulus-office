import { describe, expect, test } from "bun:test";
import { classifyRun } from "./classify.ts";

const goCrash = `unexpected fault address 0x2e004a330020
fatal error: fault
[signal SIGSEGV: segmentation violation code=0x1 addr=0x2e004a330020 pc=0x6862a5]

goroutine 5776 gp=0x3e004dbcc5a0 m=92 mp=0x3e004763d008 [running]:
runtime.throw({0xfdfe0a?, 0x3e004d7168f0?})`;

describe("classifyRun", () => {
  test("exit 0 is ok regardless of output", () => {
    expect(classifyRun(0, "")).toBe("ok");
    expect(classifyRun(0, goCrash)).toBe("ok");
  });

  test("a Go runtime fault with no diagnostics is a compiler crash", () => {
    expect(classifyRun(2, goCrash)).toBe("compiler_crash");
    expect(classifyRun(2, "fatal error: fault\n")).toBe("compiler_crash");
  });

  test("a diagnostic in our sources is a type error, even next to crash markers", () => {
    const out = `src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n${goCrash}`;
    expect(classifyRun(2, out)).toBe("type_error");
  });

  test("diagnostics only inside node_modules lib files count as a crash", () => {
    const out =
      "../../node_modules/.bun/@typescript+typescript-linux-x64@7.0.2/node_modules/@typescript/typescript-linux-x64/lib/lib.dom.d.ts(120,3): error TS1005: ';' expected.\n";
    expect(classifyRun(2, out)).toBe("compiler_crash");
  });

  test("mixed node_modules and source diagnostics are a type error", () => {
    const out =
      "../../node_modules/x/lib.d.ts(1,1): error TS1005: ';' expected.\nsrc/b.ts(9,1): error TS2304: Cannot find name 'q'.\n";
    expect(classifyRun(2, out)).toBe("type_error");
  });

  test("a failure with no recognisable output is a type error (not retried)", () => {
    expect(classifyRun(1, "something else went wrong")).toBe("type_error");
    expect(classifyRun(2, "")).toBe("type_error");
  });
});
