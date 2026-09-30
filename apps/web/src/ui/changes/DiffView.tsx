/**
 * One file's diff against the merge-base (#38): hunks with line numbers,
 * or a note for binary, too large and truncated diffs, and before/after
 * previews for images. Reloads when the file's entry changes in a poll.
 */
import type { ChangedFile, FileDiff } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { type ChangesApi, describeChangesFailure } from "./api.ts";
import { ImagePreview } from "./ImagePreview.tsx";

type State =
  | { status: "loading" }
  | { status: "ready"; diff: FileDiff }
  | { status: "error"; text: string };

export function DiffView(props: {
  api: ChangesApi;
  agentId: string;
  file: ChangedFile;
  head: string | null;
}) {
  const { api, agentId, file, head } = props;
  const version = `${head}|${file.kind}|${file.sig}|${file.additions}|${file.deletions}`;
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    void api.file(agentId, file.path).then((res) => {
      if (!alive) return;
      setState(
        res.ok
          ? { status: "ready", diff: res.data }
          : { status: "error", text: describeChangesFailure(res) },
      );
    });
    return () => {
      alive = false;
    };
  }, [api, agentId, file.path, version]);

  if (state.status === "loading") return <p className="rg-field__hint">Loading diff…</p>;
  if (state.status === "error") {
    return (
      <p role="alert" className="rg-form-alert">
        {state.text}
      </p>
    );
  }
  const { diff } = state;
  return (
    <div className="rg-changes-diff" data-testid="changes-diff">
      {diff.image && (diff.image.base || diff.image.work) && (
        <ImagePreview
          api={api}
          agentId={agentId}
          path={diff.path}
          sides={diff.image}
          version={version}
        />
      )}
      {diff.symlink && (
        <p className="rg-field__hint">Symbolic link: the diff shows where it points.</p>
      )}
      {diff.binary && !diff.image && <p className="rg-field__hint">Binary file, not shown.</p>}
      {diff.tooLarge && <p className="rg-field__hint">This diff is too large to show here.</p>}
      {!diff.binary && !diff.tooLarge && diff.hunks.length === 0 && (
        <p className="rg-field__hint">No line changes against the base.</p>
      )}
      {diff.hunks.length > 0 && (
        <table className="rg-changes-lines">
          <tbody>
            {diff.hunks.map((h, hi) => [
              <tr key={`h${hi}`} className="rg-changes-lines__hunk">
                <td colSpan={3}>{h.header}</td>
              </tr>,
              ...h.lines.map((l, li) => (
                <tr key={`h${hi}l${li}`} className={`rg-changes-lines__${l.t}`}>
                  <td className="rg-changes-lines__no">{l.old ?? ""}</td>
                  <td className="rg-changes-lines__no">{l.new ?? ""}</td>
                  <td className="rg-changes-lines__text">
                    <span className="rg-changes-lines__sign">
                      {l.t === "add" ? "+" : l.t === "del" ? "-" : " "}
                    </span>
                    {l.text}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      )}
      {diff.truncated && (
        <p className="rg-field__hint">Only the first part of this diff is shown.</p>
      )}
    </div>
  );
}
