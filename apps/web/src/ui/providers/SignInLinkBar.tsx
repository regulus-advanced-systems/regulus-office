/**
 * The sign-in link above the login terminal (#156), with Open and Copy. The
 * link is read from the terminal in this browser ({@link findSignInUrl}); it
 * is never sent to the office server or logged.
 */
import type { CliLoginProvider } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import { type ClipboardApi, copyText } from "../terminal/clipboard.ts";
import type { TerminalHost } from "../terminal/host.ts";
import { findSignInUrl } from "./signInLink.ts";

/** New output is searched at most this often. */
export const LINK_SCAN_MS = 300;

/** The newest sign-in link in `host`'s terminal, rechecked as output arrives. */
export function useSignInLink(
  host: TerminalHost | null,
  provider: CliLoginProvider,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scan = () => {
      timer = null;
      const { cols, lines } = host.readBuffer();
      const found = findSignInUrl(lines, cols, provider);
      // Keep the last link while the CLI redraws the screen without it.
      if (found) setUrl(found);
    };
    const off = host.onWrite(() => {
      if (!timer) timer = setTimeout(scan, LINK_SCAN_MS);
    });
    scan();
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [host, provider]);
  return url;
}

/** "claude.ai/oauth/authorize…": enough to recognise the link without the long query. */
export function shortLink(url: string): string {
  const { host, pathname } = new URL(url);
  const path = pathname === "/" ? "" : pathname;
  return `${host}${path.length > 32 ? `${path.slice(0, 32)}…` : path}…`;
}

export function SignInLinkBar({
  url,
  clipboard,
}: {
  url: string | null;
  clipboard?: ClipboardApi;
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!url) {
    return (
      <p className="rg-providers__link rg-muted" data-testid="sign-in-link">
        The sign-in link appears here when the CLI prints it.
      </p>
    );
  }
  return (
    <div className="rg-providers__link" data-testid="sign-in-link">
      <span className="rg-providers__link-label">Sign-in link</span>
      <code className="rg-providers__link-url" title={url}>
        {shortLink(url)}
      </code>
      <a
        className="rg-btn rg-btn--primary rg-btn--sm"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open
      </a>
      <Button
        size="sm"
        onClick={() => void copyText(url, clipboard).then((ok) => setCopied(ok ? "yes" : "failed"))}
      >
        {copied === "yes" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
      </Button>
    </div>
  );
}
