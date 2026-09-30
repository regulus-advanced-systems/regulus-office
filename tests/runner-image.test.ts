/**
 * runner/Dockerfile keeps the agent CLIs from updating themselves (#162): they are installed
 * root-owned and runners are non-root, so an in-runner update can only fail and show errors in
 * robot and login terminals. Versions come from the pinned image.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";

const dockerfile = await Bun.file(join(import.meta.dir, "../runner/Dockerfile")).text();

test("Claude Code's updater is off in the runner image", () => {
  const env = dockerfile.match(/^ENV .*DISABLE_AUTOUPDATER.*$/m)?.[0] ?? "";
  expect(env).toContain("DISABLE_AUTOUPDATER=1");
  expect(env).toContain("DISABLE_UPDATES=1");
});

test("Codex's startup update check is off in the system config layer", () => {
  expect(dockerfile).toContain("'check_for_update_on_startup = false' > /etc/codex/config.toml");
});
