/**
 * The search match inside a robot's terminal modal (#41). A robot's live
 * view is tmux on the alternate screen, which has no scrollback to scroll
 * to, so the modal opened from a search result first shows the indexed
 * scrollback around the hit, scrolled to the matching line and
 * highlighted, over the live terminal. "Back to live" removes it. The server checks again that the viewer may watch
 * this robot before it returns any line.
 */
import type { SearchContextResponse } from "@regulus/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { defaultSearchApi, type SearchApi } from "./api.ts";
import { highlightTerms, Snippet } from "./Snippet.tsx";
import { useSearchStore } from "./searchStore.ts";
import "./search.css";

type Loaded =
  | { state: "loading" }
  | { state: "ready"; context: SearchContextResponse; terms: string[] }
  | { state: "gone" };

/** Lower-cased words of a query, as the server splits them. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      (query.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? []).map((w) => w.toLowerCase()),
    ),
  ];
}

export function SearchReveal({
  agentId,
  api = defaultSearchApi,
}: {
  agentId: string;
  api?: SearchApi;
}) {
  const reveal = useSearchStore((s) => (s.reveal?.agentId === agentId ? s.reveal : null));
  const setReveal = useSearchStore((s) => s.setReveal);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const matchRef = useRef<HTMLLIElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // The match belongs to this opening of the terminal only.
  useEffect(
    () => () => {
      const store = useSearchStore.getState();
      if (store.reveal?.agentId === agentId) store.setReveal(null);
    },
    [agentId],
  );

  useEffect(() => {
    if (!reveal) return;
    const abort = new AbortController();
    setLoaded({ state: "loading" });
    void api.context(reveal.docId, reveal.query, abort.signal).then((res) => {
      if (abort.signal.aborted) return;
      setLoaded(
        res.ok
          ? { state: "ready", context: res.data, terms: queryTerms(reveal.query) }
          : { state: "gone" },
      );
    });
    return () => abort.abort();
  }, [reveal, api]);

  useEffect(() => {
    if (loaded.state === "ready") matchRef.current?.scrollIntoView?.({ block: "center" });
  }, [loaded]);

  if (!reveal) return null;
  const close = () => {
    // Keep the keyboard in the dialog (Escape, Tab) once the button under focus goes away.
    sectionRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
    setReveal(null);
  };
  return (
    <section
      ref={sectionRef}
      className="rg-search-reveal"
      aria-label="Search match in the terminal's history"
      data-testid="search-reveal"
    >
      <div className="rg-search-reveal__bar">
        <span className="rg-search-reveal__title">
          Match for “{reveal.query}” in this terminal's history
        </span>
        <Button size="sm" variant="primary" onClick={close}>
          Back to live
        </Button>
      </div>
      {loaded.state === "loading" && <p className="rg-search-reveal__note">Loading…</p>}
      {loaded.state === "gone" && (
        <p className="rg-search-reveal__note" role="status">
          That part of the history is no longer available.
        </p>
      )}
      {loaded.state === "ready" && (
        <ol className="rg-search-reveal__lines" data-testid="search-reveal-lines">
          {loaded.context.lines.map((line, i) => {
            const match = i === loaded.context.matchLine;
            return (
              <li
                key={i}
                ref={match ? matchRef : undefined}
                className={match ? "rg-search-reveal__line--match" : undefined}
                data-match={match || undefined}
              >
                <Snippet segments={highlightTerms(line || " ", loaded.terms)} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
