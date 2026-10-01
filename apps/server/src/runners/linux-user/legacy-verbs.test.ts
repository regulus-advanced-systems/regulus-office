/**
 * Verbs renamed in the helper keep working against a helper (or sudoers
 * file) installed before the rename: #226 renamed `remove-floor` to
 * `remove-operation`.
 */
import { describe, expect, test } from "bun:test";
import { LinuxUserRunner } from "./linux-user-runner.ts";

describe("LinuxUserRunner with an older helper", () => {
  test("a helper installed before #226 is asked with the old remove-floor verb, with a warning", async () => {
    const verbs: string[] = [];
    const warned: string[] = [];
    const legacyHelper = (allowsLegacy: boolean) =>
      new LinuxUserRunner({
        logger: { warn: (_obj, msg) => warned.push(msg) },
        run: async ({ argv }) => {
          verbs.push(argv[3] ?? "");
          return argv[3] === "remove-floor" && allowsLegacy
            ? { code: 0, stdout: "removed=/srv/office/projects/apollo\n", stderr: "" }
            : { code: 1, stdout: "", stderr: "sudo: a password is required" };
        },
      });
    expect(await legacyHelper(true).removeOperationDirs("apollo")).toEqual([
      "/srv/office/projects/apollo",
    ]);
    expect(verbs).toEqual(["remove-operation", "remove-floor"]);
    expect(warned).toEqual([expect.stringContaining("deprecated remove-floor verb")]);
    // When both fail, the error names the current verb.
    await expect(legacyHelper(false).removeOperationDirs("apollo")).rejects.toThrow(
      "office-runner-helper remove-operation failed",
    );
  });

  test("the current helper is asked once, with the current verb", async () => {
    const verbs: string[] = [];
    const runner = new LinuxUserRunner({
      run: async ({ argv }) => {
        verbs.push(argv[3] ?? "");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    expect(await runner.removeOperationDirs("apollo")).toEqual([]);
    expect(verbs).toEqual(["remove-operation"]);
  });
});
