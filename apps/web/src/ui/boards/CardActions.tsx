/**
 * Write actions on a card for operation managers (#36): assign / unassign,
 * comment, merge a PR (squash, merge or rebase) and close. The server checks
 * `manage` again, calls GitHub with the office credential and audits it;
 * comments go out with a footer naming the human "via Regulus Office".
 * Merge and close ask for a second click.
 */
import {
  type BoardCardDetail,
  MERGE_METHODS,
  type MergeMethod,
  VIA_OFFICE,
} from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { type BoardResult, type BoardsApi, type CardRef, describeBoardFailure } from "./api.ts";

const METHOD_LABELS: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

type Busy = "assign" | "comment" | "merge" | "close" | null;

export function CardActions({
  api,
  cardRef,
  detail,
  onChanged,
}: {
  api: BoardsApi;
  cardRef: CardRef;
  detail: BoardCardDetail;
  onChanged: () => Promise<void> | void;
}) {
  const id = useId();
  const toast = useUiStore((s) => s.toast);
  const me = useSessionStore((s) => s.user?.displayName ?? "you");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [logins, setLogins] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [method, setMethod] = useState<MergeMethod>("squash");
  const [confirm, setConfirm] = useState<"merge" | "close" | null>(null);
  const open = detail.state === "open" && !detail.merged;
  const noun = cardRef.kind === "pr" ? "pull request" : "issue";

  useEffect(() => {
    if (!detail.credential) return;
    let live = true;
    void api.assignees(cardRef.operationId, cardRef.repoId).then((res) => {
      if (live && res.ok) setLogins(res.data.logins);
    });
    return () => {
      live = false;
    };
  }, [api, cardRef.operationId, cardRef.repoId, detail.credential]);

  const run = async <T,>(
    what: Exclude<Busy, null>,
    call: () => Promise<BoardResult<T>>,
    done: string,
  ) => {
    setBusy(what);
    setError(null);
    const res = await call();
    setBusy(null);
    setConfirm(null);
    if (!res.ok) {
      setError(describeBoardFailure(res));
      return false;
    }
    toast({ kind: "success", message: done });
    await onChanged();
    return true;
  };

  const assign = async () => {
    const who = login.trim().replace(/^@/, "");
    if (!who) return;
    if (await run("assign", () => api.assign(cardRef, { add: [who] }), `Assigned @${who}.`))
      setLogin("");
  };
  const unassign = (who: string) =>
    run("assign", () => api.assign(cardRef, { remove: [who] }), `Unassigned @${who}.`);
  const postComment = async () => {
    if (!comment.trim()) return;
    if (await run("comment", () => api.comment(cardRef, comment), "Comment posted."))
      setComment("");
  };
  const merge = () => run("merge", () => api.merge(cardRef, method), `Merged #${cardRef.number}.`);
  const close = () => run("close", () => api.close(cardRef), `Closed #${cardRef.number}.`);

  return (
    <section className="rg-card__actions" aria-label="Actions">
      <h3 className="rg-card__section">Actions</h3>
      {!detail.credential && (
        <p className="rg-card__muted">
          The office has no GitHub connection for {detail.repo}, so these actions cannot reach
          GitHub.
        </p>
      )}
      {error && (
        <p role="alert" className="rg-card__error">
          {error}
        </p>
      )}
      <fieldset className="rg-card__fieldset" disabled={busy !== null || !detail.credential}>
        <div className="rg-card__row">
          <label className="rg-field__label" htmlFor={`${id}-assignee`}>
            Assign
          </label>
          <input
            id={`${id}-assignee`}
            className="rg-input"
            list={`${id}-logins`}
            value={login}
            placeholder="GitHub login"
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void assign();
            }}
          />
          <datalist id={`${id}-logins`}>
            {logins.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <Button size="sm" onClick={() => void assign()} disabled={!login.trim()}>
            Assign
          </Button>
        </div>
        {detail.assignees.length > 0 && (
          <ul className="rg-card__assignees">
            {detail.assignees.map((a) => (
              <li key={a}>
                @{a}{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void unassign(a)}
                  aria-label={`Unassign ${a}`}
                >
                  Unassign
                </Button>
              </li>
            ))}
          </ul>
        )}

        <label className="rg-field__label" htmlFor={`${id}-comment`}>
          Comment
        </label>
        <textarea
          id={`${id}-comment`}
          className="rg-input rg-card__comment-input"
          rows={3}
          maxLength={8000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="rg-card__row rg-card__row--end">
          <span className="rg-card__muted">
            Posted as {me} {VIA_OFFICE}
          </span>
          <Button size="sm" onClick={() => void postComment()} disabled={!comment.trim()}>
            Comment
          </Button>
        </div>

        {open && cardRef.kind === "pr" && (
          <div className="rg-card__row">
            <label className="rg-field__label" htmlFor={`${id}-method`}>
              Merge
            </label>
            <select
              id={`${id}-method`}
              className="rg-input"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as MergeMethod);
                setConfirm(null);
              }}
            >
              {MERGE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            {confirm === "merge" ? (
              <Button variant="primary" size="sm" onClick={() => void merge()}>
                Confirm merge
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setConfirm("merge")}>
                Merge…
              </Button>
            )}
          </div>
        )}
        {open && (
          <div className="rg-card__row rg-card__row--end">
            {confirm === "close" ? (
              <>
                <span className="rg-card__muted">Close this {noun} on GitHub?</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  Keep open
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void close()}>
                  Close {noun}
                </Button>
              </>
            ) : (
              <Button variant="destructive" size="sm" onClick={() => setConfirm("close")}>
                Close {noun}…
              </Button>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}
