import { describe, expect, test } from "bun:test";
import { parseRepoRef, repoKey, repoRemoteUrl, repoWebUrl } from "./repo-ref.ts";

describe("parseRepoRef", () => {
  test.each([
    ["octocat/Hello-World", "octocat", "Hello-World"],
    ["  octocat/Hello-World/ ", "octocat", "Hello-World"],
    ["https://github.com/octocat/Hello-World", "octocat", "Hello-World"],
    ["https://github.com/octocat/Hello-World.git", "octocat", "Hello-World"],
    ["https://www.github.com/octocat/hello.world/", "octocat", "hello.world"],
  ])("%s", (input, owner, name) => {
    expect(parseRepoRef(input)).toEqual({ ok: true, ref: { owner, name } });
  });

  test("rejects credentials in URLs so tokens never land in a remote", () => {
    expect(parseRepoRef("https://x-access-token:ghp_FAKE@github.com/o/r")).toEqual({
      ok: false,
      error: "credentials_in_url",
    });
  });

  test("rejects other hosts, schemes and malformed paths", () => {
    expect(parseRepoRef("https://gitlab.com/o/r")).toMatchObject({ error: "unsupported_host" });
    expect(parseRepoRef("http://github.com/o/r")).toMatchObject({ error: "unsupported_host" });
    expect(parseRepoRef("file:///etc/passwd")).toMatchObject({ error: "unsupported_host" });
    for (const bad of ["o", "o/r/x", "../r", "o/..", "-o/r", "o/r name", "https://github.com/o"]) {
      expect(parseRepoRef(bad).ok).toBe(false);
    }
  });

  test("URLs and keys", () => {
    const ref = { owner: "Octo", name: "Repo" };
    expect(repoWebUrl(ref)).toBe("https://github.com/Octo/Repo");
    expect(repoRemoteUrl("file:///tmp/remotes/", ref)).toBe("file:///tmp/remotes/Octo/Repo.git");
    expect(repoKey(ref)).toBe("octo/repo");
  });
});
