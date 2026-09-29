/** GitHub App JWT and the installation token cache (#141). */
import { describe, expect, test } from "bun:test";
import { createVerify } from "node:crypto";
import {
  appJwt,
  InstallationTokenCache,
  parseAppKey,
  TOKEN_REFRESH_MARGIN_MS,
} from "./app-auth.ts";
import { testAppKey } from "./fake-github.ts";

const { privateKey, publicKey } = testAppKey();

describe("app JWT", () => {
  test("RS256, iat 60 s back, exp within GitHub's 10 minutes, iss = client id", () => {
    const now = Date.UTC(2026, 8, 29, 12, 0, 0);
    const jwt = appJwt({ appId: 42, clientId: "Iv23abc", privateKey }, now);
    const [h = "", p = "", sig = ""] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims.iss).toBe("Iv23abc");
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(600);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  test("falls back to the app id as issuer; accepts a key with escaped newlines", () => {
    const escaped = privateKey.replace(/\n/g, "\\n");
    const jwt = appJwt({ appId: 42, clientId: null, privateKey: escaped }, Date.now());
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString());
    expect(claims.iss).toBe("42");
  });

  test("a bad key fails without echoing it", () => {
    const bad =
      "-----BEGIN RSA PRIVATE KEY-----\nNOTAKEYsecretmaterial\n-----END RSA PRIVATE KEY-----";
    expect(() => parseAppKey(bad)).toThrow("not a valid RSA PEM key");
    try {
      parseAppKey(bad);
    } catch (err) {
      expect((err as Error).message).not.toContain("secretmaterial");
    }
  });
});

describe("installation token cache", () => {
  test("reuses a token until five minutes before it expires, then mints again", async () => {
    const clock = { now: 1_000_000 };
    const cache = new InstallationTokenCache(() => clock.now);
    let minted = 0;
    const mint = async () => {
      minted += 1;
      return { token: `ghs_token${minted}`, expiresAt: clock.now + 60 * 60_000 };
    };
    expect(await cache.get("1:repo", mint)).toBe("ghs_token1");
    clock.now += 50 * 60_000;
    expect(await cache.get("1:repo", mint)).toBe("ghs_token1");
    clock.now += 10 * 60_000 - TOKEN_REFRESH_MARGIN_MS + 1;
    expect(await cache.get("1:repo", mint)).toBe("ghs_token2");
    expect(minted).toBe(2);
  });

  test("keys are separate; concurrent callers share one mint; a failed mint is not cached", async () => {
    const cache = new InstallationTokenCache();
    let minted = 0;
    const mint = async () => {
      minted += 1;
      await Bun.sleep(5);
      return { token: `ghs_t${minted}`, expiresAt: Date.now() + 3_600_000 };
    };
    const [a, b] = await Promise.all([cache.get("1:*", mint), cache.get("1:*", mint)]);
    expect(a).toBe(b);
    expect(await cache.get("1:other", mint)).not.toBe(a);
    expect(minted).toBe(2);
    await expect(
      cache.get("2:*", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await cache.get("2:*", mint)).toBe("ghs_t3");
  });
});
