import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { ConfigError, DEFAULT_PORT, loadConfig, redactConfig, SecretValue } from "./config.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const AUTH_SECRET = Buffer.alloc(32, 9).toString("base64");

describe("loadConfig", () => {
  test("applies defaults when the environment is empty", () => {
    const c = loadConfig({});
    expect(c.port).toBe(DEFAULT_PORT);
    expect(c.host).toBe("0.0.0.0");
    expect(c.dataDir).toMatch(/\/data$/);
    expect(c.masterKey).toBeUndefined();
    expect(c.publicUrl).toBe(`http://localhost:${DEFAULT_PORT}`);
    expect(c.logLevel).toBe("info");
    expect(c.webDist).toMatch(/apps\/web\/dist$/);
    expect(c.shutdownTimeoutMs).toBe(10_000);
    expect(c.betterAuthSecret).toBeUndefined();
    expect(c.githubOAuth).toBeUndefined();
    expect(c.openSignup).toBe(false);
  });

  test("projects dir: /srv/office/projects in production, under the data dir otherwise", () => {
    expect(loadConfig({ NODE_ENV: "production" }).projectsDir).toBe("/srv/office/projects");
    expect(loadConfig({ OFFICE_DATA_DIR: "/tmp/od" }).projectsDir).toBe("/tmp/od/projects");
    expect(loadConfig({ OFFICE_PROJECTS_DIR: "/var/p", NODE_ENV: "production" }).projectsDir).toBe(
      "/var/p",
    );
  });

  test("runner backend: docker in production, local otherwise; local refused in production", () => {
    expect(loadConfig({ NODE_ENV: "production" }).runnerBackend).toBe("docker");
    expect(loadConfig({}).runnerBackend).toBe("local");
    expect(loadConfig({ OFFICE_RUNNER_BACKEND: "linux-user" }).runnerBackend).toBe("linux-user");
    expect(() => loadConfig({ NODE_ENV: "production", OFFICE_RUNNER_BACKEND: "local" })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ OFFICE_RUNNER_BACKEND: "k8s" })).toThrow(/OFFICE_RUNNER_BACKEND/);
  });

  test("GitHub remote base defaults to github.com and accepts local bare repos", () => {
    expect(loadConfig({}).githubRemoteBase).toBe("https://github.com");
    expect(loadConfig({ OFFICE_GITHUB_REMOTE_BASE: "file:///tmp/remotes/" }).githubRemoteBase).toBe(
      "file:///tmp/remotes",
    );
    expect(() => loadConfig({ OFFICE_GITHUB_REMOTE_BASE: "not a url" })).toThrow(
      /OFFICE_GITHUB_REMOTE_BASE/,
    );
  });

  test("worktrees dir and GitHub API base have production and dev defaults", () => {
    expect(loadConfig({ NODE_ENV: "production" }).worktreesDir).toBe("/srv/office/worktrees");
    expect(loadConfig({ OFFICE_DATA_DIR: "/tmp/od" }).worktreesDir).toBe("/tmp/od/worktrees");
    expect(loadConfig({ OFFICE_WORKTREES_DIR: "/var/w" }).worktreesDir).toBe("/var/w");
    expect(loadConfig({}).githubApiBase).toBe("https://api.github.com");
    expect(loadConfig({ OFFICE_GITHUB_API_BASE: "http://127.0.0.1:9/" }).githubApiBase).toBe(
      "http://127.0.0.1:9",
    );
  });

  test("parses OFFICE_OPEN_SIGNUP as a boolean", () => {
    expect(loadConfig({ OFFICE_OPEN_SIGNUP: "true" }).openSignup).toBe(true);
    expect(loadConfig({ OFFICE_OPEN_SIGNUP: "1" }).openSignup).toBe(true);
    expect(loadConfig({ OFFICE_OPEN_SIGNUP: "No" }).openSignup).toBe(false);
    expect(loadConfig({ OFFICE_OPEN_SIGNUP: "" }).openSignup).toBe(false);
    expect(() => loadConfig({ OFFICE_OPEN_SIGNUP: "maybe" })).toThrow(/OFFICE_OPEN_SIGNUP/);
  });

  test("reads the auth variables and wraps secrets", () => {
    const c = loadConfig({
      BETTER_AUTH_SECRET: AUTH_SECRET,
      GITHUB_CLIENT_ID: "Iv1.abc",
      GITHUB_CLIENT_SECRET: "gh-secret-value",
    });
    expect(c.betterAuthSecret?.expose()).toBe(AUTH_SECRET);
    expect(String(c.betterAuthSecret)).toBe("[redacted]");
    expect(c.githubOAuth?.clientId).toBe("Iv1.abc");
    expect(c.githubOAuth?.clientSecret.expose()).toBe("gh-secret-value");
    expect(JSON.stringify(c)).not.toContain("gh-secret-value");
  });

  test("rejects a short BETTER_AUTH_SECRET without echoing it", () => {
    const bad = () => loadConfig({ BETTER_AUTH_SECRET: "tooshort" });
    expect(bad).toThrow(ConfigError);
    expect(bad).toThrow(/BETTER_AUTH_SECRET/);
    expect(bad).not.toThrow(/tooshort/);
  });

  test("requires GitHub client id and secret together", () => {
    expect(() => loadConfig({ GITHUB_CLIENT_ID: "Iv1.abc" })).toThrow(/GITHUB_CLIENT_SECRET/);
    expect(() => loadConfig({ GITHUB_CLIENT_SECRET: "s" })).toThrow(/GITHUB_CLIENT_ID/);
  });

  test("reads every OFFICE_* variable", () => {
    const c = loadConfig({
      OFFICE_PORT: "0",
      OFFICE_HOST: "127.0.0.1",
      OFFICE_DATA_DIR: "/tmp/office-data",
      OFFICE_MASTER_KEY: KEY,
      OFFICE_PUBLIC_URL: "https://office.example.com",
      OFFICE_LOG_LEVEL: "debug",
      OFFICE_WEB_DIST: "/srv/web",
      OFFICE_SHUTDOWN_TIMEOUT_MS: "250",
    });
    expect(c.port).toBe(0);
    expect(c.host).toBe("127.0.0.1");
    expect(c.dataDir).toBe("/tmp/office-data");
    expect(c.masterKey?.expose()).toEqual(new Uint8Array(32).fill(7));
    expect(c.publicUrl).toBe("https://office.example.com");
    expect(c.logLevel).toBe("debug");
    expect(c.webDist).toBe("/srv/web");
    expect(c.shutdownTimeoutMs).toBe(250);
  });

  test("treats blank values as unset", () => {
    const c = loadConfig({
      OFFICE_PORT: "",
      OFFICE_MASTER_KEY: "  ",
      OFFICE_PUBLIC_URL: "",
      OFFICE_LOG_LEVEL: "",
      OFFICE_DATA_DIR: "",
    });
    expect(c.port).toBe(DEFAULT_PORT);
    expect(c.masterKey).toBeUndefined();
    expect(c.logLevel).toBe("info");
    expect(c.dataDir).toMatch(/\/data$/);
  });

  test("rejects bad values and names the variable without echoing the value", () => {
    const bad = () =>
      loadConfig({ OFFICE_PORT: "99999", OFFICE_LOG_LEVEL: "loud", OFFICE_MASTER_KEY: "short" });
    expect(bad).toThrow(ConfigError);
    try {
      bad();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("OFFICE_PORT");
      expect(msg).toContain("OFFICE_LOG_LEVEL");
      expect(msg).toContain("OFFICE_MASTER_KEY");
      expect(msg).toContain("32 bytes");
      expect(msg).not.toContain("short");
      expect(msg).not.toContain("loud");
    }
  });

  test("rejects a master key that is not 32 bytes", () => {
    expect(() => loadConfig({ OFFICE_MASTER_KEY: Buffer.alloc(16).toString("base64") })).toThrow(
      /32 bytes/,
    );
  });
});

describe("SecretValue", () => {
  const s = new SecretValue("hunter2");
  test("never stringifies to the secret", () => {
    expect(String(s)).toBe("[redacted]");
    expect(`${s}`).toBe("[redacted]");
    expect(JSON.stringify({ s })).toBe('{"s":"[redacted]"}');
    expect(inspect(s)).toBe("[redacted]");
    expect(Bun.inspect(s)).not.toContain("hunter2");
  });
  test("exposes on request only", () => {
    expect(s.expose()).toBe("hunter2");
  });
});

describe("redactConfig", () => {
  test("replaces the master key and reports presence", () => {
    const dump = redactConfig(loadConfig({ OFFICE_MASTER_KEY: KEY }));
    expect("masterKey" in dump).toBe(false);
    expect(dump.masterKeySet).toBe(true);
    expect(JSON.stringify(dump)).not.toContain(KEY);
    expect(redactConfig(loadConfig({})).masterKeySet).toBe(false);
  });

  test("drops auth secrets and keeps only the GitHub client id", () => {
    const dump = redactConfig(
      loadConfig({
        BETTER_AUTH_SECRET: AUTH_SECRET,
        GITHUB_CLIENT_ID: "Iv1.abc",
        GITHUB_CLIENT_SECRET: "gh-secret-value",
      }),
    );
    const text = JSON.stringify(dump);
    expect(dump.betterAuthSecretSet).toBe(true);
    expect(dump.githubOAuth).toEqual({ clientId: "Iv1.abc" });
    expect(text).not.toContain(AUTH_SECRET);
    expect(text).not.toContain("gh-secret-value");
  });
});
