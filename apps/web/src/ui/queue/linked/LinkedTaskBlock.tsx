/**
 * Under a queue task that is one part of a linked task (#257): the parts this
 * viewer may see, each with its room, state and pull request, and the combined
 * state. The task's owner also gets the notes the henchmen left for them, a
 * button to pass each on to the other parts, and a button that stops every
 * part. Nobody else is sent the notes.
 */
import type { LinkedTaskView } from "@regulus/protocol";
import { useRef, useState } from "react";
import type { ApiResult } from "../../auth/api.ts";
import { Button } from "../../components/Button.tsx";
import { createLinkedTasksApi, describeLinkedTaskError, type LinkedTasksApi } from "./api.ts";
import { linkedHeadline, partLine } from "./linkedModel.ts";
import { refreshLinked } from "./linkedStore.ts";

const defaultApi = createLinkedTasksApi();

/** Who can read a note once it is passed on. */
export const PASS_ON_WARNING =
  "A note you pass on is written into the other parts' working directories. Everyone who can " +
  "watch a henchman in any of this task's rooms can read it there, also people who cannot see " +
  "the room it came from.";

function Notes({
  view,
  pending,
  act,
  api,
}: {
  view: LinkedTaskView;
  pending: boolean;
  act: (call: () => Promise<ApiResult<unknown>>) => void;
  api: LinkedTasksApi;
}) {
  const notes = view.notes ?? [];
  const room = (taskId: string) => view.parts.find((p) => p.taskId === taskId)?.roomName ?? "";
  return (
    <section className="rg-queue__linked-notes" aria-label="Notes from the henchmen">
      <div className="rg-queue__linked-head">Notes for you</div>
      {notes.length === 0 ? (
        <p className="rg-queue__empty">No notes yet. Only you see them.</p>
      ) : (
        <ul className="rg-queue__linked-parts">
          {notes.map((note) => (
            <li key={note.id} className="rg-queue__linked-note-row" data-note={note.id}>
              <span className="rg-queue__linked-room">{room(note.taskId)}</span>
              <pre className="rg-queue__linked-note-body">{note.body}</pre>
              {note.releasedAt > 0 ? (
                <span className="rg-queue__linked-repo">passed on</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  title={PASS_ON_WARNING}
                  onClick={() => act(() => api.releaseNote(view.id, note.id))}
                >
                  Pass on to the other parts
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="rg-queue__also-hint">{PASS_ON_WARNING}</p>
      <label className="rg-queue__also-link">
        <input
          type="checkbox"
          checked={view.autoNotes === true}
          disabled={pending}
          onChange={(e) => {
            const on = e.target.checked;
            act(() => api.setAutoNotes(view.id, on));
          }}
        />{" "}
        Pass new notes on without asking me
      </label>
    </section>
  );
}

export function LinkedTaskBlock({
  view,
  taskId,
  operationId,
  api = defaultApi,
}: {
  view: LinkedTaskView;
  /** The part this block hangs under. */
  taskId: string;
  operationId: string | null;
  api?: LinkedTasksApi;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const act = (call: () => Promise<ApiResult<unknown>>) => {
    // The pressed button is disabled and may be gone afterwards: keep the focus in the
    // panel, or Escape and Tab stop working (focus would fall to <body>).
    root.current?.focus();
    setPending(true);
    setError(null);
    void call().then(async (result) => {
      if (!result.ok) setError(describeLinkedTaskError(result));
      await refreshLinked(operationId, api);
      setPending(false);
    });
  };
  return (
    <div className="rg-queue__linked" data-linked={view.id} ref={root} tabIndex={-1}>
      <div className="rg-queue__linked-head">{linkedHeadline(view)}</div>
      <ul className="rg-queue__linked-parts">
        {view.parts.map((part) => {
          const line = partLine(part);
          return (
            <li
              key={part.taskId}
              className={`rg-queue__linked-part rg-queue__linked-part--${part.state}`}
              aria-current={part.taskId === taskId ? "true" : undefined}
            >
              <span className="rg-queue__linked-room">
                {part.roomName}
                {part.taskId === taskId ? " (this room)" : ""}
              </span>
              <span className="rg-queue__linked-repo">{part.repo}</span>
              <span className="rg-queue__linked-state">{line.state}</span>
              {line.pull &&
                (part.prUrl ? (
                  <a href={part.prUrl} target="_blank" rel="noreferrer noopener">
                    {line.pull}
                  </a>
                ) : (
                  <span>{line.pull}</span>
                ))}
              {line.note && <span className="rg-queue__linked-note">{line.note}</span>}
            </li>
          );
        })}
      </ul>
      {view.notes && <Notes view={view} pending={pending} act={act} api={api} />}
      {error && <div className="rg-queue__reason">{error}</div>}
      {view.mayStop && (
        <div className="rg-queue__task-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => act(() => api.stop(view.id))}
          >
            {pending ? "Working…" : "Stop the whole task"}
          </Button>
        </div>
      )}
    </div>
  );
}
