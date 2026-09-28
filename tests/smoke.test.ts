import { expect, test } from "bun:test";

// Keeps `bun test` green until real suites land (M0 tasks add theirs per package).
test("workspace test runner is wired", () => {
  expect(1 + 1).toBe(2);
});
