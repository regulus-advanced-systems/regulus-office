/**
 * The facts the office decides itself (#253): Sentry over REST, what a finding may cite, a host key.
 * what is asked of Sentry and how its answers are read. A stand-in `fetch`
 * answers; no request leaves the machine.
 */
import { describe, expect, test } from "bun:test";
import { Secret } from "@regulus/agent-adapters";
import { fingerprints, keyLines, knownHostsFile, pinOf } from "./hostkey.ts";
import {
  BODY_MAX,
  eventLines,
  httpSentryApi,
  ISSUES_MAX,
  nextCursor,
  parseIssue,
  SentryError,
} from "./sentry-api.ts";
import { cite, type Signal, signalView, storedKey } from "./signals.ts";

const TOKEN = "sntryu_FAKE0123456789abcdef";
const conn = { host: "sentry.io", organization: "acme", token: Secret.of(TOKEN) };
const RAW = {
  id: "1001",
  shortId: "web-1",
  title: "TypeError: x is undefined",
  culprit: "handler(orders)",
  level: "error",
  count: "14",
  userCount: 3,
  firstSeen: "2026-10-09T08:00:00Z",
  lastSeen: "2026-10-09T09:00:00Z",
  substatus: "regressed",
  permalink: "https://acme.sentry.io/issues/1001/",
  project: { slug: "Web", id: "7" },
};

function fakeFetch(
  answer: (
    url: string,
    init: RequestInit,
  ) => { status?: number; body?: unknown; link?: string; text?: string },
) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    calls.push({
      url,
      method: init.method ?? "GET",
      auth: headers.get("authorization"),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const out = answer(url, init);
    return new Response(out.text ?? JSON.stringify(out.body ?? null), {
      status: out.status ?? 200,
      headers: out.link ? { link: out.link } : {},
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

describe("reading Sentry", () => {
  test("an issue: Sentry's own id, short id, project and state", () => {
    expect(parseIssue(RAW)).toEqual({
      id: "1001",
      shortId: "WEB-1",
      project: "web",
      title: "TypeError: x is undefined",
      culprit: "handler(orders)",
      level: "error",
      count: 14,
      userCount: 3,
      firstSeen: Date.parse("2026-10-09T08:00:00Z"),
      lastSeen: Date.parse("2026-10-09T09:00:00Z"),
      substatus: "regressed",
      permalink: "https://acme.sentry.io/issues/1001/",
    });
    for (const bad of [null, {}, { ...RAW, id: "../../x" }, { ...RAW, shortId: "" }]) {
      expect(parseIssue(bad)).toBeNull();
    }
  });

  test("the issues of one project are asked of that project's own path, with the token as a header", async () => {
    const f = fakeFetch(() => ({ body: [RAW, { junk: true }] }));
    const issues = await httpSentryApi(f.fetch).issues(conn, "web", "is:unresolved firstSeen:-3h");
    expect(issues.issues.map((i) => i.shortId)).toEqual(["WEB-1"]);
    expect(issues.more).toBe(false);
    expect(f.calls).toEqual([
      {
        url: "https://sentry.io/api/0/projects/acme/web/issues/?query=is%3Aunresolved+firstSeen%3A-3h&limit=25&sort=date",
        method: "GET",
        auth: `Bearer ${TOKEN}`,
        body: undefined,
      },
    ]);
    expect(f.calls[0]?.url).not.toContain(TOKEN);
  });

  test("a long list is read in pages by Sentry's cursor, up to a limit, and says when there is more", async () => {
    const link = (cursor: string, results: boolean) =>
      `<https://evil.example/api/0/x/?cursor=${cursor}>; rel="previous"; results="false"; cursor="0:0:1", ` +
      `<https://evil.example/api/0/x/?cursor=${cursor}>; rel="next"; results="${results}"; cursor="${cursor}"`;
    expect(nextCursor(link("0:25:0", true))).toBe("0:25:0");
    expect(nextCursor(link("0:25:0", false))).toBeNull();
    expect(nextCursor(link("x&project=other", true))).toBeNull();
    expect(nextCursor(null)).toBeNull();
    const page = (from: number) =>
      Array.from({ length: 25 }, (_, i) => ({
        ...RAW,
        id: String(from + i),
        shortId: `web-${from + i}`,
      }));
    // A burst of 40: both pages are read, nothing is dropped.
    const forty = fakeFetch((url) =>
      url.includes("cursor=")
        ? { body: page(26).slice(0, 15), link: link("0:50:0", false) }
        : { body: page(1), link: link("0:25:0", true) },
    );
    const burst = await httpSentryApi(forty.fetch).issues(conn, "web", "is:unresolved");
    expect([burst.issues.length, burst.more]).toEqual([40, false]);
    // The next page is asked of the same project, with the cursor only: never an address from the answer.
    expect(forty.calls.map((c) => c.url)).toEqual([
      "https://sentry.io/api/0/projects/acme/web/issues/?query=is%3Aunresolved&limit=25&sort=date",
      "https://sentry.io/api/0/projects/acme/web/issues/?query=is%3Aunresolved&limit=25&sort=date&cursor=0%3A25%3A0",
    ]);
    // More than the limit: it stops, and says so.
    let n = 0;
    const endless = fakeFetch(() => ({
      body: page(1 + 25 * n++),
      link: link(`0:${25 * n}:0`, true),
    }));
    const many = await httpSentryApi(endless.fetch).issues(conn, "web", "is:unresolved");
    expect([many.issues.length, many.more, endless.calls.length]).toEqual([ISSUES_MAX, true, 4]);
  });

  test("an answer that is too large is not read", async () => {
    const huge = fakeFetch(() => ({ text: `["${"x".repeat(BODY_MAX)}"]` }));
    expect(httpSentryApi(huge.fetch).issues(conn, "web", "x")).rejects.toThrow(
      new SentryError("answer_too_large"),
    );
    const junk = fakeFetch(() => ({ text: "<html>" }));
    expect(httpSentryApi(junk.fetch).issues(conn, "web", "x")).rejects.toThrow(
      new SentryError("bad_answer"),
    );
  });

  test("when an issue last regressed is Sentry's own record of it", async () => {
    const f = fakeFetch(() => ({
      body: {
        activity: [
          { type: "set_regression", dateCreated: "2026-10-01T00:00:00Z" },
          { type: "note", dateCreated: "2026-10-09T00:00:00Z" },
          { type: "set_regression", dateCreated: "2026-10-05T00:00:00Z" },
        ],
      },
    }));
    const api = httpSentryApi(f.fetch);
    expect(await api.regressedAt(conn, "1001")).toBe(Date.parse("2026-10-05T00:00:00Z"));
    expect(f.calls[0]?.url).toBe("https://sentry.io/api/0/organizations/acme/issues/1001/");
    expect(
      await httpSentryApi(fakeFetch(() => ({ body: {} })).fetch).regressedAt(conn, "1"),
    ).toBeNull();
    // An id that is not Sentry's own never reaches a URL.
    expect(api.regressedAt(conn, "1001/../../x")).rejects.toThrow(new SentryError("bad_issue_id"));
  });

  test("an event is a few lines: the exception and its last frames", () => {
    const lines = eventLines({
      title: "TypeError: x is undefined",
      entries: [
        { type: "request", data: {} },
        {
          type: "exception",
          data: {
            values: [
              {
                type: "TypeError",
                value: "x is undefined",
                stacktrace: {
                  frames: [
                    { function: "main", filename: "index.js", lineNo: 3 },
                    { function: "handler", filename: "src/orders.js", lineNo: 42 },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
    expect(lines).toEqual([
      "TypeError: x is undefined",
      "TypeError: x is undefined",
      "    at handler (src/orders.js:42)",
      "    at main (index.js:3)",
    ]);
    expect(eventLines(null)).toEqual([]);
  });

  test("a comment is the only thing written; a failure is a short code, never Sentry's text or the token", async () => {
    const ok = fakeFetch(() => ({ status: 201, body: { id: "9" } }));
    await httpSentryApi(ok.fetch).comment(conn, "1001", "a verdict");
    expect(ok.calls).toEqual([
      {
        url: "https://sentry.io/api/0/organizations/acme/issues/1001/comments/",
        method: "POST",
        auth: `Bearer ${TOKEN}`,
        body: { text: "a verdict" },
      },
    ]);
    const denied = fakeFetch(() => ({ status: 403, body: { detail: `bad token ${TOKEN}` } }));
    let error: unknown;
    try {
      await httpSentryApi(denied.fetch).issues(conn, "web", "is:unresolved");
    } catch (err) {
      error = err;
    }
    expect(error).toEqual(new SentryError("http_403"));
    expect(String(error)).not.toContain(TOKEN);
    const down = (async () => {
      throw new Error(`connect failed with ${TOKEN}`);
    }) as unknown as typeof fetch;
    expect(httpSentryApi(down).issues(conn, "web", "x")).rejects.toThrow(
      new SentryError("network_error"),
    );
  });
});

describe("what a finding may cite", () => {
  const signal: Signal = {
    key: "sentry:acme/WEB-1",
    kind: "sentry",
    label: "WEB-1",
    summary: "WEB-1 in web: TypeError",
    lines: ["one", "two", "three"],
    project: "web",
    ref: "1001",
    regressed: false,
  };
  const handed = { [signal.key]: signal };

  test("only keys the office handed out in this part, and their lines by number", () => {
    const cited = cite(handed, "op-apollo", [{ key: signal.key, lines: [3, 1, 3, 99] }]);
    expect(cited.evidence).toBe("WEB-1: WEB-1 in web: TypeError\nthree\none");
    expect(cited.sources).toEqual([
      {
        kind: "sentry",
        key: "sentry:acme/WEB-1@op-apollo",
        label: "WEB-1",
        url: undefined,
        project: "web",
        ref: "1001",
        regressed: false,
      },
    ]);
    expect(cited.sentry).toBe(true);
    // Without numbers: the first lines. A key cited twice counts once.
    expect(cite(handed, null, [{ key: signal.key }, { key: signal.key }]).evidence).toBe(
      "WEB-1: WEB-1 in web: TypeError\none\ntwo\nthree",
    );
    // A key nobody handed out, also one that names something every object has.
    for (const key of ["sentry:acme/OTHER-9", "__proto__", "constructor", "toString"]) {
      expect(() => cite(handed, null, [{ key }])).toThrow(
        "that is not a signal key watchdog_check returned in this turn",
      );
    }
  });

  test("the stored key holds the room, and whether a fault is back is the office's flag", () => {
    expect(storedKey("pm2:a:err:b", null)).toBe("pm2:a:err:b@office");
    expect(storedKey("pm2:a:err:b", "op-1")).toBe("pm2:a:err:b@op-1");
    const known = { title: "t", disposition: "notify" };
    expect(signalView(signal, known)).toMatchObject({
      from: "Sentry",
      lines: [
        { n: 1, text: "one" },
        { n: 2, text: "two" },
        { n: 3, text: "three" },
      ],
      known,
    });
    const back = signalView({ ...signal, regressed: true }, known);
    expect("back" in back).toBe(true);
    expect("known" in back).toBe(false);
  });
});

describe("a host's public key", () => {
  const A = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAA";
  const B = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY=";

  test("is kept as key lines, whatever the address and comments around them", () => {
    const text = `# vps.example.com:22 SSH-2.0-OpenSSH\nvps.example.com ${B}\n|1|hashed|host= ${A} root@vps\n\nnot a key\n`;
    expect(keyLines(text)).toEqual([B, A].sort());
    expect(pinOf(text)).toBe([B, A].sort().join("\n"));
    expect(pinOf("nothing here")).toBe("");
    expect(knownHostsFile("vps.example.com", 22, A)).toBe(`vps.example.com ${A}\n`);
    expect(knownHostsFile("10.0.0.5", 2222, A)).toBe(`[10.0.0.5]:2222 ${A}\n`);
  });

  test("is shown as a fingerprint", () => {
    expect(fingerprints(`${A}\n${B}`).map((f) => f.split(" ")[0])).toEqual([
      "ecdsa-sha2-nistp256",
      "ssh-ed25519",
    ]);
    expect(fingerprints(A)[0]).toMatch(/^ssh-ed25519 SHA256:[A-Za-z0-9+/]{43}$/);
  });
});
