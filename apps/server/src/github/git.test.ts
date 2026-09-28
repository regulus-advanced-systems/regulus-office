import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_PAT, makeBareRepo } from "../floors/test-helpers.ts";
import {
  basicAuthHeader,
  gitAuthEnv,
  gitBaseEnv,
  redactGitOutput,
  runGit,
  summarizeGitError,
} from "./git.ts";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-git-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("git credentials", () => {
  test("the token travels as an http.extraHeader env, not argv or URL", () => {
    const env = gitAuthEnv(FAKE_PAT);
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(basicAuthHeader(FAKE_PAT));
    expect(gitAuthEnv(null)).toEqual({});
  });

  test("the header can be scoped to one remote URL", () => {
    const env = gitAuthEnv(FAKE_PAT, "https://github.com/o/r.git");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/o/r.git.extraHeader");
  });

  test("the base env isolates git from the office process and user config", () => {
    const env = gitBaseEnv({ PATH: "/bin", HOME: "/h", OFFICE_MASTER_KEY: "x", GH_TOKEN: "y" });
    expect(env).toMatchObject({
      PATH: "/bin",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
    });
    expect(Object.keys(env)).not.toContain("OFFICE_MASTER_KEY");
    expect(Object.keys(env)).not.toContain("GH_TOKEN");
  });

  test("output is redacted: token, header form, URL userinfo, Authorization lines", () => {
    const header = basicAuthHeader(FAKE_PAT);
    const text = [
      `fatal: token ${FAKE_PAT} rejected`,
      `> ${header}`,
      "fatal: unable to access 'https://user:hunter2@github.com/o/r.git/'",
    ].join("\n");
    const out = redactGitOutput(text, [FAKE_PAT]);
    expect(out).not.toContain(FAKE_PAT);
    expect(out).not.toContain(header.split(" ").at(-1) ?? "never");
    expect(out).not.toContain("hunter2");
    expect(summarizeGitError(`Cloning into 'x'...\n${text}`, [FAKE_PAT])).not.toContain("Cloning");
  });

  test("clones a local repo with a token and leaves no credential on disk", async () => {
    const base = await makeBareRepo(join(root, "remotes"), "octo", "hello", "trunk");
    const dest = join(root, "clone");
    const r = await runGit(["clone", "--quiet", "--", `${base}/octo/hello.git`, dest], {
      token: FAKE_PAT,
    });
    expect(r.code).toBe(0);
    const config = await readFile(join(dest, ".git", "config"), "utf8");
    expect(config).not.toContain(FAKE_PAT);
    expect(config).not.toContain("extraHeader");
    const head = await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: dest });
    expect(head.stdout.trim()).toBe("trunk");
  });

  test("a failed command reports a redacted stderr and a non-zero code", async () => {
    const r = await runGit(
      ["clone", "--", `file://${root}/missing/${FAKE_PAT}.git`, join(root, "x")],
      {
        token: FAKE_PAT,
      },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).not.toContain(FAKE_PAT);
    expect(r.stderr).toContain("[redacted]");
  });
});
