import { describe, expect, test } from "bun:test";
import type { BufferLine } from "../terminal/host.ts";
import { allowedSignInUrl, findSignInUrl, joinWrappedLines, SIGN_IN_HOSTS } from "./signInLink.ts";

/** Fake-CLI output only: these are not real sign-in links. */
const CLAUDE_URL =
  "https://claude.ai/oauth/authorize?code=true&client_id=00000000-0000-4000-8000-000000000000" +
  "&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback" +
  "&scope=user%3Ainference&code_challenge=FAKEchallenge&code_challenge_method=S256&state=FAKEstate";
const CODEX_URL =
  "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_FAKE" +
  "&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+profile+email" +
  "&code_challenge=FAKEchallenge&code_challenge_method=S256&state=FAKEstate";

/**
 * The screen as xterm holds it at `cols`: each printed line cut at the width. `soft` marks the
 * continuation lines as xterm soft wraps; otherwise they look like tmux drew them edge to edge.
 */
function screen(text: string, cols: number, soft: boolean): BufferLine[] {
  const out: BufferLine[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) out.push({ text: "", wrapped: false });
    for (let at = 0; at < line.length; at += cols) {
      out.push({ text: line.slice(at, at + cols), wrapped: soft && at > 0 });
    }
  }
  return out;
}

const claudeScreen = [
  "Welcome to Claude Code (fake)",
  "",
  "Browser didn't open? Use the url below to sign in:",
  "",
  CLAUDE_URL,
  "",
  "Paste code here if prompted > ",
].join("\n");

const codexScreen = [
  "Starting local login server on http://localhost:1455.",
  "If your browser did not open, navigate to this URL to authenticate:",
  "",
  CODEX_URL,
  "",
  "Press Ctrl+C to cancel",
].join("\n");

describe("sign-in link finder", () => {
  for (const soft of [true, false]) {
    test(`Claude: the whole link from a wrapped screen (${soft ? "xterm" : "tmux"} wraps)`, () => {
      for (const cols of [60, 93, 124, 160]) {
        expect(findSignInUrl(screen(claudeScreen, cols, soft), cols, "claude-code")).toBe(
          CLAUDE_URL,
        );
      }
    });

    test(`Codex: the whole link (${soft ? "xterm" : "tmux"} wraps); localhost is not a sign-in link`, () => {
      expect(findSignInUrl(screen(codexScreen, 80, soft), 80, "codex")).toBe(CODEX_URL);
    });
  }

  test("each provider only matches its own auth hosts", () => {
    expect(findSignInUrl(screen(codexScreen, 80, true), 80, "claude-code")).toBeNull();
    expect(findSignInUrl(screen(claudeScreen, 80, true), 80, "codex")).toBeNull();
  });

  test("the host allow-list is exact, https only, no credentials or ports", () => {
    const claude = SIGN_IN_HOSTS["claude-code"];
    expect(allowedSignInUrl("https://claude.ai/oauth/authorize?x=1", claude)).toBe(
      "https://claude.ai/oauth/authorize?x=1",
    );
    expect(allowedSignInUrl("https://console.anthropic.com/oauth", claude)).not.toBeNull();
    expect(allowedSignInUrl("http://claude.ai/oauth", claude)).toBeNull();
    expect(allowedSignInUrl("https://claude.ai.evil.example/oauth", claude)).toBeNull();
    expect(allowedSignInUrl("https://evilclaude.ai/oauth", claude)).toBeNull();
    expect(allowedSignInUrl("https://user@claude.ai/oauth", claude)).toBeNull();
    expect(allowedSignInUrl("https://claude.ai:8443/oauth", claude)).toBeNull();
    expect(allowedSignInUrl("not a url", claude)).toBeNull();
  });

  test("a look-alike link is ignored, a link inside another link's query is not picked out", () => {
    const lines = screen(
      [
        "https://claude.ai.evil.example/oauth/authorize?x=1",
        "https://evil.example/r?to=https://claude.ai/oauth/authorize",
      ].join("\n"),
      120,
      true,
    );
    expect(findSignInUrl(lines, 120, "claude-code")).toBeNull();
  });

  test("the newest link wins; trailing punctuation is dropped", () => {
    const lines = screen(
      "Open https://claude.ai/old.\nOr open (https://claude.ai/oauth/new).",
      120,
      true,
    );
    expect(findSignInUrl(lines, 120, "claude-code")).toBe("https://claude.ai/oauth/new");
  });

  test("full-width lines of plain text are not glued onto a link", () => {
    const joined = joinWrappedLines(
      [
        { text: "abcd", wrapped: false },
        { text: "efgh", wrapped: false },
        { text: " ijk", wrapped: false },
      ],
      4,
    );
    expect(joined).toEqual(["abcdefgh", " ijk"]);
    expect(
      joinWrappedLines(
        [
          { text: "ab", wrapped: false },
          { text: "cd", wrapped: false },
        ],
        4,
      ),
    ).toEqual(["ab", "cd"]);
  });
});
