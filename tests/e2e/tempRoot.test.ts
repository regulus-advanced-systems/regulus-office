import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pickTempRoot, SMALL_TEMP_BYTES } from "./tempRoot.ts";

const base = { asked: undefined, system: "/tmp", local: "/repo/.e2e-local/tmp" };

describe("pickTempRoot", () => {
  test("the system temp directory when it is roomy, or its size is unknown", () => {
    expect(pickTempRoot({ ...base, systemBytes: SMALL_TEMP_BYTES })).toBe("/tmp");
    expect(pickTempRoot({ ...base, systemBytes: 80 * 1024 ** 3 })).toBe("/tmp");
    expect(pickTempRoot({ ...base, systemBytes: null })).toBe("/tmp");
  });

  test("the repository's own directory when the system one is a small file system", () => {
    expect(pickTempRoot({ ...base, systemBytes: 3.9 * 1024 ** 3 })).toBe("/repo/.e2e-local/tmp");
  });

  test("E2E_TMP_DIR wins, as an absolute path", () => {
    expect(pickTempRoot({ ...base, asked: "/big/disk", systemBytes: 1 })).toBe("/big/disk");
    expect(pickTempRoot({ ...base, asked: "runs", systemBytes: 80 * 1024 ** 3 })).toBe(
      resolve("runs"),
    );
  });
});
