/**
 * The bookshelf reader (#264): the room's shelf on the left (its Markdown
 * files by folder, a box that filters them by name and searches their
 * text), the open document on the right. Links between documents stay in
 * the reader; Back returns to the page before.
 *
 * Everything shown comes from the gated routes; when the office answers
 * that the room is closed (access taken away while reading), the reader
 * drops what it holds and says so.
 */
import {
  BOOKSHELF_LIMITS,
  type BookshelfDocument,
  type BookshelfHit,
  type BookshelfListing,
} from "@regulus/protocol";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { pageTurnGain, playPageTurn } from "../../audio/pageTurn.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { findAnchor } from "./anchors.ts";
import { type BookshelfApi, defaultBookshelfApi, type ShelfFailure } from "./api.ts";
import { useBookshelfStore } from "./bookshelfStore.ts";
import { DocView } from "./DocView.tsx";
import { groupByFolder, SHELF_MESSAGES } from "./shelfModel.ts";

export const SHELF_SEARCH_DEBOUNCE_MS = 250;
/** A search the office was too busy for is asked again this often, this many times. */
export const SHELF_SEARCH_RETRY_MS = 700;
export const SHELF_SEARCH_RETRIES = 5;

type Loaded<T> = { key: string; data: T | null; error: ShelfFailure | null };

export function BookshelfPanel({ api = defaultBookshelfApi }: { api?: BookshelfApi }) {
  const operationId = useBookshelfStore((s) => s.operationId);
  const page = useBookshelfStore((s) => s.page);
  const canGoBack = useBookshelfStore((s) => s.history.length > 0);
  const { close, go, back } = useBookshelfStore.getState();
  const [shelf, setShelf] = useState<Loaded<BookshelfListing> | null>(null);
  const [doc, setDoc] = useState<Loaded<BookshelfDocument> | null>(null);
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<{ q: string; hits: BookshelfHit[]; more: boolean } | null>(null);
  const article = useRef<HTMLDivElement>(null);
  /** Text to bring into view once the document a search hit named has loaded. */
  const seek = useRef<string | null>(null);
  const [sought, setSought] = useState(0);
  const filterId = useId();

  const listing = shelf && shelf.key === operationId ? shelf : null;
  const docKey = operationId && page ? `${operationId}\0${page.path}` : null;
  const opened = doc && doc.key === docKey ? doc : null;
  const closed = listing?.error === "closed" || opened?.error === "closed";

  useEffect(() => {
    setFilter("");
    setHits(null);
    if (!operationId) return;
    const abort = new AbortController();
    void api.listing(operationId, abort.signal).then((res) => {
      if (abort.signal.aborted) return;
      setShelf({
        key: operationId,
        data: res.ok ? res.data : null,
        error: res.ok ? null : res.error,
      });
      const first = res.ok ? res.data.docs.find((d) => !d.tooLarge) : undefined;
      if (first && !useBookshelfStore.getState().page) go(first.path);
    });
    return () => abort.abort();
  }, [operationId, api, go]);

  const path = page?.path ?? null;
  useEffect(() => {
    if (!operationId || !path) return;
    const key = `${operationId}\0${path}`;
    const abort = new AbortController();
    void api.document(operationId, path, abort.signal).then((res) => {
      if (abort.signal.aborted) return;
      setDoc({ key, data: res.ok ? res.data : null, error: res.ok ? null : res.error });
      if (res.ok) playPageTurn(pageTurnGain(useUiStore.getState().settings));
      // Access was taken away while reading: the list goes too.
      else if (res.error === "closed") setShelf({ key: operationId, data: null, error: "closed" });
    });
    return () => abort.abort();
  }, [operationId, path, api]);

  // Once the document is on the page: its heading, the search hit's line, or the top.
  const anchor = page?.anchor ?? "";
  const shown = opened?.data ?? null;
  useEffect(() => {
    const root = article.current;
    if (!root || !shown) return;
    const wanted = seek.current?.toLowerCase();
    seek.current = null;
    const target =
      findAnchor(root, anchor) ??
      (wanted
        ? [...root.querySelectorAll(".rg-doc > *")].find((el) =>
            el.textContent?.toLowerCase().includes(wanted),
          )
        : null);
    if (target) target.scrollIntoView?.({ block: "start" });
    else root.scrollTop = 0;
    // `sought`: a hit in the page already open asks again without a load.
  }, [shown, anchor, sought]);

  const query = filter.trim();
  useEffect(() => {
    if (!operationId || query.length < BOOKSHELF_LIMITS.queryMin) {
      setHits(null);
      return;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // Dropping the request (a new keystroke, the reader closed) stops the search on the server.
    const ask = (triesLeft: number) => {
      void api
        .search(operationId, query.slice(0, BOOKSHELF_LIMITS.queryMax), abort.signal)
        .then((res) => {
          if (abort.signal.aborted) return;
          // The office runs a few searches at a time: asked again shortly, a few times.
          if (!res.ok && res.error === "busy" && triesLeft > 0) {
            timer = setTimeout(() => ask(triesLeft - 1), SHELF_SEARCH_RETRY_MS);
            return;
          }
          setHits(res.ok ? { q: query, hits: res.data.hits, more: res.data.truncated } : null);
        });
    };
    timer = setTimeout(() => ask(SHELF_SEARCH_RETRIES), SHELF_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [operationId, query, api]);

  const docs = listing?.data?.docs;
  const onShelf = useMemo(() => new Set((docs ?? []).map((d) => d.path)), [docs]);
  const folders = useMemo(() => groupByFolder(docs ?? [], query), [docs, query]);

  if (!operationId) return null;
  const data = listing?.data ?? null;
  const emptyNote = closed
    ? SHELF_MESSAGES.closed
    : !listing
      ? "Fetching the shelf…"
      : listing.error
        ? SHELF_MESSAGES[listing.error]
        : data && data.state !== "ready"
          ? SHELF_MESSAGES[data.state]
          : data && data.docs.length === 0
            ? "This repo has no Markdown files."
            : null;

  return (
    <Modal
      open
      onClose={close}
      title={data?.repo ? `Bookshelf: ${data.repo}` : "Bookshelf"}
      width={1120}
      className="rg-modal--bookshelf"
    >
      {emptyNote ? (
        <p className="rg-shelf__note" role="status">
          {emptyNote}
        </p>
      ) : (
        <div className="rg-shelf">
          <nav className="rg-shelf__side" aria-label="Documents">
            <label className="rg-field__label" htmlFor={filterId}>
              Find on the shelf
            </label>
            <input
              id={filterId}
              className="rg-input rg-shelf__filter"
              type="search"
              value={filter}
              maxLength={BOOKSHELF_LIMITS.queryMax}
              placeholder="File name or text"
              onChange={(e) => setFilter(e.currentTarget.value)}
            />
            <div className="rg-shelf__list rg-scroll-shadows">
              {folders.map((folder) => (
                <section key={folder.name} aria-label={folder.name || "Top of the repo"}>
                  <h2 className="rg-shelf__folder">{folder.name || "/"}</h2>
                  <ul>
                    {folder.docs.map((d) => (
                      <li key={d.path}>
                        <button
                          type="button"
                          className="rg-shelf__doc"
                          aria-current={d.path === path ? "page" : undefined}
                          disabled={d.tooLarge}
                          title={d.tooLarge ? "Too large to open here" : d.path}
                          onClick={() => go(d.path)}
                        >
                          {d.path.slice(folder.name ? folder.name.length + 1 : 0)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {query !== "" && folders.length === 0 && (
                <p className="rg-shelf__hint">No file name matches.</p>
              )}
              {hits && hits.q === query && (
                <section aria-label="In the text">
                  <h2 className="rg-shelf__folder">In the text</h2>
                  {hits.hits.length === 0 && <p className="rg-shelf__hint">No line matches.</p>}
                  <ul>
                    {hits.hits.map((hit) => (
                      <li key={`${hit.path}:${hit.line}`}>
                        <button
                          type="button"
                          className="rg-shelf__hit"
                          onClick={() => {
                            seek.current = hits.q;
                            setSought((n) => n + 1);
                            go(hit.path);
                          }}
                        >
                          <span className="rg-shelf__hit-where">
                            {hit.path}:{hit.line}
                          </span>
                          <span className="rg-shelf__hit-text">{hit.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {hits.more && <p className="rg-shelf__hint">More lines match; narrow it down.</p>}
                </section>
              )}
            </div>
            {data && (
              <p className="rg-shelf__hint">
                {data.total > data.docs.length
                  ? `${data.docs.length} of ${data.total} files · `
                  : ""}
                {data.branch} at {data.commit}
              </p>
            )}
          </nav>
          <section className="rg-shelf__reader" aria-label={path ?? "Document"}>
            <div className="rg-shelf__bar">
              <Button variant="ghost" size="sm" disabled={!canGoBack} onClick={back}>
                Back
              </Button>
              <span className="rg-shelf__path">{path ?? ""}</span>
            </div>
            <div ref={article} className="rg-shelf__page rg-scroll-shadows" tabIndex={0}>
              {!page ? (
                <p className="rg-shelf__note">Pick a document.</p>
              ) : !opened ? (
                <p className="rg-shelf__note">Opening…</p>
              ) : opened.data ? (
                <DocView
                  operationId={operationId}
                  path={opened.data.path}
                  markdown={opened.data.markdown}
                  shelf={onShelf}
                  onOpen={go}
                />
              ) : (
                <p className="rg-shelf__note" role="status">
                  {SHELF_MESSAGES[opened.error ?? "failed"]}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
