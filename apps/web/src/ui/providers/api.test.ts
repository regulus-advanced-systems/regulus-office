import { describe, expect, test } from "bun:test";
import { describeLoginFailure, describeProvidersError } from "./api.ts";

describe("why a sign-in could not start (#151)", () => {
  const login = (cause?: string, reason?: string) =>
    describeProvidersError({ ok: false, status: 502, code: "login_unavailable", cause, reason });

  test("each classified cause has its own message", () => {
    expect(login("runner_api", "Docker Engine: POST <path>: 500 RWLayer … nil")).toBe(
      "Your runner could not start (Docker Engine: POST <path>: 500 RWLayer … nil). The office " +
        "replaces a broken runner and keeps your sign-ins; try again, and if it keeps failing " +
        "ask the operator to check Docker on the host.",
    );
    expect(login("runner_image_missing")).toContain("runner image is missing on the host");
    expect(login("runner_busy", "the runner needs a new mount")).toBe(
      "Your runner is busy changing its setup (the runner needs a new mount). Try again in a moment.",
    );
    expect(login("cli_missing", "codex is not installed in the runner")).toBe(
      "The CLI is not installed in your runner (codex is not installed in the runner). " +
        "Ask the operator to rebuild the runner image.",
    );
    expect(login("runner_helper")).toContain("runner helper failed");
    expect(login("start_failed", "the CLI stopped before the sign-in began")).toBe(
      "The sign-in could not start in your runner (the CLI stopped before the sign-in began).",
    );
  });

  test("never guesses that the CLI is missing", () => {
    for (const cause of [undefined, "runner_api", "runner_image_missing", "runner_busy"]) {
      expect(describeLoginFailure(cause, undefined)).not.toContain("CLI is not installed");
      expect(describeLoginFailure(cause, undefined)).not.toContain("Is the CLI installed");
    }
  });
});
