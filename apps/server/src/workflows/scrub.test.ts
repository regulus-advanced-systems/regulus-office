/** Secret scrubbing of henchman output (#155 review): exact secrets in every encoding, key shapes. */
import { describe, expect, test } from "bun:test";
import { findSecret } from "./executor.ts";
import { SecretScrubber } from "./scrub.ts";

const KEY = "sk-ant-api03-Zx9_wQ-realistic-office-key-value-000111";
const TOKEN = "ghs_fakeInstallationToken42x77abcdef";
const s = new SecretScrubber({ office_key: KEY, installation_token: TOKEN });
const b64 = (t: string, url = false) => Buffer.from(t).toString(url ? "base64url" : "base64");

describe("exact run secrets", () => {
  test("plain, split by invisible characters or whitespace", () => {
    expect(s.find(`here: ${KEY}.`)?.kind).toBe("run_secret:office_key");
    expect(s.find([...KEY].join("​"))?.kind).toBe("run_secret:office_key");
    expect(s.find([...KEY].join("⁠"))?.kind).toBe("run_secret:office_key");
    expect(s.find(`${KEY.slice(0, 12)}\n  ${KEY.slice(12)}`)?.kind).toBe("run_secret:office_key");
    expect(s.find(`token ${TOKEN}`)?.kind).toBe("run_secret:installation_token");
  });

  test("base64 at any offset (standard and URL-safe), URL-encoded and hex", () => {
    for (const prefix of ["", "a", "ab", "ANTHROPIC_API_KEY=", "PATH=/usr/bin\0HOME=/h\0KEY="]) {
      expect(s.find(`blob ${b64(prefix + KEY)} end`)?.kind).toBe("run_secret:office_key");
      expect(s.find(b64(`${prefix}${KEY}xyz`, true))?.kind).toBe("run_secret:office_key");
    }
    // A key wrapped across lines, the way `base64` prints.
    const wrapped = b64(`X=${KEY}`).replace(/(.{20})/g, "$1\n");
    expect(s.find(wrapped)?.kind).toBe("run_secret:office_key");
    expect(s.find(encodeURIComponent(`k=${KEY}`).replace(/-/g, "%2D"))?.kind).toBe(
      "run_secret:office_key",
    );
    expect(s.find(Buffer.from(KEY).toString("hex"))?.kind).toBe("run_secret:office_key");
    expect(s.find(b64(TOKEN))?.kind).toBe("run_secret:installation_token");
  });
});

describe("key shapes", () => {
  test("provider keys the run does not hold", () => {
    const none = new SecretScrubber();
    expect(none.find("sk-ant-api03-abcdefghijklmnopqrstuv")?.kind).toBe("anthropic_key");
    expect(none.find("OPENAI=sk-proj-abcdefghijklmnopqrstuvwx")?.kind).toBe("openai_key");
    expect(none.find("ghp_abcdefghijklmnopqrstuvwxyz0123")?.kind).toBe("github_token");
    expect(none.find("github_pat_11ABCDEFG0123456789_abcdefghij")?.kind).toBe("github_pat");
    expect(none.find("AIzaSyA-abcdefghijklmnopqrstuvwxyz01234")?.kind).toBe("google_key");
    expect(none.find(b64("key: ghp_abcdefghijklmnopqrstuvwxyz0123"))?.kind).toBe("github_token");
  });

  test("ordinary review text passes", () => {
    const review =
      "The `sk-` prefix check in `auth.ts:12` misses keys; see ask-for-approval. Base64 of 'hello' is aGVsbG8=. Use @types/node.";
    expect(s.find(review)).toBeNull();
  });

  test("redact never leaves a secret behind", () => {
    const out = s.redact(`a ${KEY} b ${b64(`x${KEY}`)} c`);
    expect(out).not.toContain(KEY);
    expect(s.find(out)).toBeNull();
    expect(s.redact("git fetch failed: 403")).toBe("git fetch failed: 403");
  });
});

describe("the whole answer", () => {
  test("summary, inline comments, paths, labels and pieces spread over fields", () => {
    const review = { summary: "ok", verdict: "comment" as const, comments: [], labels: [] };
    expect(findSecret(s, review)).toBeNull();
    expect(findSecret(s, { ...review, labels: [KEY] })?.kind).toBe("run_secret:office_key");
    expect(
      findSecret(s, { ...review, comments: [{ path: "a.ts", line: 1, body: b64(KEY) }] })?.kind,
    ).toBe("run_secret:office_key");
    expect(
      findSecret(s, { ...review, summary: KEY.slice(0, 20), labels: [KEY.slice(20)] })?.kind,
    ).toBe("run_secret:office_key");
  });
});

describe("dry-run preview", () => {
  test("a key in PR text is redacted from the rendered prompt", async () => {
    const { dryRun } = await import("./dry-run.ts");
    const { WorkflowInput } = await import("@regulus/protocol");
    const spec = WorkflowInput.parse({
      name: "w",
      trigger: { kind: "pull_request", actions: ["opened"] },
      henchman: { provider: "claude-code", promptTemplate: "{{pr.title}}\n{{pr.body}}" },
    });
    const ctx = {
      deliveryId: "d",
      event: "pull_request.opened",
      name: "pull_request",
      action: "opened",
      source: "webhook",
      receivedAt: 0,
      repo: { owner: "o", name: "r", fullName: "o/r" },
      repoIds: [],
      operationIds: ["f"],
      sender: null,
      fromOfficeApp: false,
      stale: false,
      pr: {
        number: 1,
        title: "t",
        body: "use sk-ant-api03-abcdefghijklmnopqrstuv please",
        author: "a",
      },
    } as never;
    const out = dryRun(spec, "f", ctx);
    expect(out.prompt).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuv");
    expect(out.prompt).toContain("[redacted]");
  });
});
