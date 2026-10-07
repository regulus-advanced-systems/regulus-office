/**
 * "What it remembers" and "Notes" on an agent's card (#136): the agent's
 * memories or notes as the office keeps them, with search, add, change and
 * delete. Shown only to those who may read them.
 */
import {
  type MindEntriesResponse,
  type MindEntry,
  type MindEntryKind,
  OFFICE_AGENT_MIND_LIMITS,
} from "@regulus/protocol";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeOfficeAgentsError, type OfficeAgentsApi } from "./api.ts";
import { ago } from "./labels.ts";

const WORDS = {
  memory: {
    one: "memory",
    search: "Search what it remembers",
    none: "It remembers nothing yet. It saves things as you talk, or add one here.",
    add: "Add a memory",
  },
  note: {
    one: "note",
    search: "Search its notes",
    none: "No notes yet. It writes them when asked to, or add one here.",
    add: "Add a note",
  },
} as const;

export function MindEntries({
  api,
  agentId,
  kind,
  now,
}: {
  api: OfficeAgentsApi;
  agentId: string;
  kind: MindEntryKind;
  now: number;
}) {
  const searchId = useId();
  const words = WORDS[kind];
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<MindEntriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    async (q: string) => {
      const res = await api.entries(agentId, kind, q.trim());
      if (res.ok) setPage(res.data);
      else setError(describeOfficeAgentsError(res));
    },
    [api, agentId, kind],
  );
  useEffect(() => {
    void load("");
  }, [load]);

  const done = async (res: { ok: true } | Parameters<typeof describeOfficeAgentsError>[0]) => {
    if (!res.ok) return setError(describeOfficeAgentsError(res));
    setError(null);
    setAdding(false);
    setEditing(null);
    setConfirming(null);
    await load(query);
  };
  const save = async (event: FormEvent, entry?: MindEntry) => {
    event.preventDefault();
    const text = textRef.current?.value ?? "";
    const title = titleRef.current?.value.trim() ?? "";
    if (entry) {
      const patch = kind === "note" ? { title, text } : { text };
      return done(await api.updateEntry(agentId, entry.id, patch));
    }
    await done(
      await api.addEntry(
        agentId,
        kind === "note" ? { kind, title, text } : { kind: "memory", text },
      ),
    );
  };

  const form = (entry?: MindEntry) => (
    <form
      className="rg-agent-mind__form"
      aria-label={entry ? `Change this ${words.one}` : words.add}
      onSubmit={(e) => void save(e, entry)}
    >
      {kind === "note" && (
        <input
          className="rg-input"
          ref={titleRef}
          aria-label="Title"
          placeholder="Title"
          required
          maxLength={OFFICE_AGENT_MIND_LIMITS.noteTitleMax}
          defaultValue={entry?.title ?? ""}
        />
      )}
      <textarea
        className="rg-input"
        ref={textRef}
        aria-label={kind === "note" ? "Text" : "What to remember"}
        rows={kind === "note" ? 6 : 2}
        required={kind === "memory"}
        maxLength={
          kind === "note"
            ? OFFICE_AGENT_MIND_LIMITS.noteTextMax
            : OFFICE_AGENT_MIND_LIMITS.memoryTextMax
        }
        defaultValue={entry?.text ?? ""}
        placeholder={
          kind === "note" ? "" : "One thing, in a sentence or two. Never a password or a key."
        }
      />
      <div className="rg-office-agent__actions">
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );

  return (
    <div className="rg-agent-mind__entries">
      <div className="rg-office-agent__actions">
        <label className="rg-sr-only" htmlFor={searchId}>
          {words.search}
        </label>
        <input
          id={searchId}
          type="search"
          className="rg-input rg-agent-mind__search"
          placeholder={words.search}
          maxLength={OFFICE_AGENT_MIND_LIMITS.queryMax}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            void load(e.currentTarget.value);
          }}
        />
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            {words.add}
          </Button>
        )}
        {page && (
          <span className="rg-muted">
            {page.total} of {page.max}
          </span>
        )}
      </div>
      {adding && form()}
      {error && <FormAlert>{error}</FormAlert>}
      {page === null && !error && <div className="rg-muted">Loading…</div>}
      {page && page.entries.length === 0 && (
        <div className="rg-muted">{query.trim() ? "Nothing found." : words.none}</div>
      )}
      <ul className="rg-agent-mind__list">
        {page?.entries.map((entry) =>
          editing === entry.id ? (
            <li key={entry.id}>{form(entry)}</li>
          ) : (
            <li key={entry.id} className="rg-agent-mind__row">
              <div className="rg-agent-mind__entry">
                {entry.title && <strong>{entry.title}</strong>}
                <div className="rg-agent-mind__text">{entry.text}</div>
                <div className="rg-muted">
                  {entry.by === "agent" ? "Saved by the agent" : "Written by a person"}
                  {entry.source ? ` · from: ${entry.source}` : ""} · {ago(entry.updatedAt, now)}
                </div>
              </div>
              <div className="rg-office-agent__actions">
                {confirming === entry.id ? (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => done(await api.removeEntry(agentId, entry.id))}
                    >
                      Delete this {words.one} for good
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(entry.id)}>
                      Change
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(entry.id)}>
                      Delete…
                    </Button>
                  </>
                )}
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
