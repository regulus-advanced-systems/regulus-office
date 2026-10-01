/**
 * The search dialog (#41): `/` opens it. Typing searches chat and robots'
 * terminal scrollback (debounced, the previous request aborted); results are
 * grouped by robot and by floor with the matching words highlighted.
 * Clicking a robot's hit walks the avatar to its desk (quick travel first
 * when it is on another floor) and opens its terminal at the match; a chat
 * hit on another floor takes the elevator there. Arrow keys move between
 * hits, Enter opens one.
 */
import { LOBBY_FLOOR_ID, type SearchGroup, type SearchHit } from "@regulus/protocol";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { travelTo } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { Modal } from "../components/Modal.tsx";
import { defaultSearchApi, type SearchApi, type SearchFailure } from "./api.ts";
import { Snippet } from "./Snippet.tsx";
import { SEARCH_OVERLAY_ID, useSearchStore } from "./searchStore.ts";
import "./search.css";

export const SEARCH_DEBOUNCE_MS = 200;

const FAILURE_TEXT: Record<SearchFailure, string> = {
  rate_limited: "Searching too fast; try again in a moment.",
  unauthorized: "Sign in to search.",
  not_found: "Nothing found.",
  failed: "Search failed.",
};

function groupTitle(group: SearchGroup): string {
  if (group.kind === "chat") return `Chat · ${group.floorName}`;
  const owner = group.ownerName ? ` (${group.ownerName})` : "";
  return `${group.robotName ?? "Henchman"}${owner} · ${group.floorName}`;
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Debounced search for the store's query; results land in the store. */
function useSearchQuery(api: SearchApi): void {
  const query = useSearchStore((s) => s.query);
  useEffect(() => {
    const store = useSearchStore.getState();
    if (!query.trim()) {
      store.setResult(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      useSearchStore.getState().setLoading();
      const res = await api.search(query, abort.signal);
      if (abort.signal.aborted) return;
      if (res.ok) useSearchStore.getState().setResult(res.data);
      else useSearchStore.getState().setResult(null, res.error);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, api]);
}

export interface SearchPanelProps {
  api?: SearchApi;
  now?: () => number;
}

export function SearchPanel({ api = defaultSearchApi, now = Date.now }: SearchPanelProps) {
  const open = useUiStore((s) => s.overlay === SEARCH_OVERLAY_ID);
  const close = useUiStore((s) => s.closeOverlay);
  const { query, status, result, error, setQuery, startJump } = useSearchStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  useSearchQuery(api);

  const onClose = () => close(SEARCH_OVERLAY_ID);

  const activate = (group: SearchGroup, hit: SearchHit) => {
    onClose();
    if (group.kind === "scrollback" && group.agentId) {
      startJump({
        agentId: group.agentId,
        floorId: group.floorId,
        seatId: group.seatId,
        docId: hit.docId,
        query,
        startedAt: now(),
      });
      return;
    }
    const here = useFloorStore.getState().floorId ?? LOBBY_FLOOR_ID;
    if (group.floorId !== here && group.floorId !== LOBBY_FLOOR_ID)
      travelTo(group.floorId, { walkIn: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const hits = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button.rg-search__hit") ?? [],
    );
    if (hits.length === 0) return;
    event.preventDefault();
    const at = hits.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    if (next < 0) inputRef.current?.focus();
    else hits[Math.min(next, hits.length - 1)]?.focus();
  };

  const groups = result?.groups ?? [];
  const terms = result?.terms ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Search" width={680} initialFocus={inputRef}>
      <div className="rg-search" onKeyDown={onKeyDown}>
        <label className="rg-field__label rg-search__label" htmlFor={inputId}>
          Search chat and henchmen's terminals
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          className="rg-input rg-search__input"
          data-testid="search-input"
          placeholder='Words, or "an exact phrase"'
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="rg-search__status" role="status" data-testid="search-status">
          {status === "loading" && "Searching…"}
          {status === "error" && error && FAILURE_TEXT[error]}
          {status === "done" && groups.length === 0 && "No matches you can see."}
          {status === "done" && result?.truncated && "Showing the best matches."}
        </p>
        <div ref={listRef} className="rg-search__results" data-testid="search-results">
          {groups.map((group) => (
            <section key={group.key} className="rg-search__group" data-group={group.key}>
              <h2 className="rg-search__group-title">
                <span className={`rg-search__kind rg-search__kind--${group.kind}`}>
                  {group.kind === "chat" ? "Chat" : "Terminal"}
                </span>
                {groupTitle(group)}
              </h2>
              <ul className="rg-search__hits">
                {group.hits.map((hit) => (
                  <li key={hit.docId}>
                    <button
                      type="button"
                      className="rg-search__hit"
                      data-testid="search-hit"
                      onClick={() => activate(group, hit)}
                    >
                      <span className="rg-search__meta">
                        {hit.author ? `${hit.author} · ` : ""}
                        {timeOf(hit.ts)}
                      </span>
                      <Snippet segments={hit.snippet} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {terms.length > 0 && groups.length > 0 && (
          <p className="rg-search__help">
            Click a terminal match to walk to that henchman's desk and open its terminal there.
          </p>
        )}
      </div>
    </Modal>
  );
}
