/**
 * "Who it is and how it works" on an agent's card (#136): the agent's soul,
 * one document, with a preview and its history. Write shows the text, Preview
 * renders it, History lists every saved version with what changed against
 * the one before it and can bring an old one back (as a new version).
 *
 * Shown only to those who may read it: the server answers nobody else.
 */
import {
  lineDiff,
  OFFICE_AGENT_MIND_LIMITS,
  type OfficeAgentSoul,
  type SoulVersion,
  type SoulVersionSummary,
} from "@regulus/protocol";
import { useCallback, useEffect, useId, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Markdown } from "../boards/Markdown.tsx";
import { Button } from "../components/Button.tsx";
import { describeOfficeAgentsError, type OfficeAgentsApi } from "./api.ts";
import { ago, SOUL_WORDS } from "./labels.ts";
import "../boards/boards.css";

type Tab = "write" | "preview" | "history";
const VERSION_WORDS: Readonly<Record<SoulVersionSummary["kind"], string>> = {
  created: "First version",
  edit: "Changed",
  revert: "Brought back",
  imported: "Carried over from the instructions it had",
};

export function SoulEditor({
  api,
  agentId,
  agentName,
  running,
  now,
  onSaved,
}: {
  api: OfficeAgentsApi;
  agentId: string;
  agentName: string;
  /** It runs now: saving stops it, and it starts with the new text at the next message. */
  running: boolean;
  now: number;
  /** The soul was saved or brought back: the card reloads the agent. */
  onSaved(): void;
}) {
  const fieldId = useId();
  const [soul, setSoul] = useState<OfficeAgentSoul | null>(null);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("write");
  const [versions, setVersions] = useState<SoulVersionSummary[] | null>(null);
  const [shown, setShown] = useState<{ version: SoulVersion; before: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: OfficeAgentSoul) => {
    setSoul(next);
    setDraft(next.content);
    setVersions(null);
    setShown(null);
  }, []);
  useEffect(() => {
    let live = true;
    void api.soul(agentId).then((res) => {
      if (!live) return;
      if (res.ok) adopt(res.data);
      else setError(describeOfficeAgentsError(res));
    });
    return () => {
      live = false;
    };
  }, [api, agentId, adopt]);

  const openHistory = async () => {
    setTab("history");
    const res = await api.soulVersions(agentId);
    if (res.ok) setVersions(res.data.versions);
    else setError(describeOfficeAgentsError(res));
  };
  const show = async (v: SoulVersionSummary) => {
    setError(null);
    const [one, before] = await Promise.all([
      api.soulVersion(agentId, v.version),
      // The version before it, when the office still keeps it.
      versions?.some((x) => x.version === v.version - 1)
        ? api.soulVersion(agentId, v.version - 1)
        : null,
    ]);
    if (!one.ok) return setError(describeOfficeAgentsError(one));
    setShown({ version: one.data, before: before?.ok ? before.data.content : "" });
  };
  const run = async (action: () => ReturnType<OfficeAgentsApi["saveSoul"]>) => {
    setBusy(true);
    setError(null);
    const res = await action();
    setBusy(false);
    if (!res.ok) return setError(describeOfficeAgentsError(res));
    adopt(res.data);
    setTab("write");
    onSaved();
  };

  if (!soul) return <div className="rg-muted">{error ?? "Loading…"}</div>;
  const dirty = draft !== soul.content;
  const max = OFFICE_AGENT_MIND_LIMITS.soulMax;
  return (
    <div className="rg-agent-soul">
      <div className="rg-agent-mind__tabs" role="tablist" aria-label={SOUL_WORDS.label}>
        {(
          [
            ["write", "Write"],
            ["preview", "Preview"],
            ["history", "History"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`rg-agent-mind__tab${tab === id ? " is-on" : ""}`}
            onClick={() => (id === "history" ? void openHistory() : setTab(id))}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "write" && (
        <>
          <label className="rg-sr-only" htmlFor={fieldId}>
            {SOUL_WORDS.label} of {agentName}
          </label>
          <textarea
            id={fieldId}
            className="rg-input rg-agent-soul__text"
            rows={10}
            maxLength={max}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            placeholder="What this agent is for, how it should talk, what it should always or never do."
          />
        </>
      )}
      {tab === "preview" && (
        <div className="rg-agent-soul__preview">
          <Markdown source={draft} empty="Nothing written yet." />
        </div>
      )}
      {tab === "history" && (
        <div className="rg-agent-soul__history">
          {versions === null && <div className="rg-muted">Loading…</div>}
          {versions?.length === 0 && <div className="rg-muted">Nothing was saved yet.</div>}
          <ul className="rg-agent-mind__list">
            {versions?.map((v) => (
              <li key={v.version} className="rg-agent-mind__row">
                <span>
                  <strong>Version {v.version}</strong>
                  {v.version === soul.version ? " (now)" : ""} · {VERSION_WORDS[v.kind]}
                  {v.revertOf ? ` version ${v.revertOf}` : ""}
                  {v.by ? ` by ${v.by}` : ""} · {ago(v.ts, now)} ·{" "}
                  <span className="rg-agent-soul__added">+{v.added}</span>{" "}
                  <span className="rg-agent-soul__removed">−{v.removed}</span> lines
                </span>
                <Button variant="ghost" size="sm" onClick={() => void show(v)}>
                  Show
                </Button>
              </li>
            ))}
          </ul>
          {shown && (
            <section
              className="rg-agent-soul__version"
              aria-label={`Version ${shown.version.version}`}
            >
              <div className="rg-field__label">
                Version {shown.version.version}: what changed against the version before it
              </div>
              <pre className="rg-agent-soul__diff">
                {lineDiff(shown.before, shown.version.content).map((d, i) => (
                  <span key={i} className={`rg-agent-soul__line is-${d.t}`}>
                    {d.t === "add" ? "+ " : d.t === "del" ? "− " : "  "}
                    {d.line}
                    {"\n"}
                  </span>
                ))}
              </pre>
              {shown.version.version !== soul.version && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => api.revertSoul(agentId, shown.version.version))}
                >
                  Bring version {shown.version.version} back
                </Button>
              )}
            </section>
          )}
        </div>
      )}
      {running && dirty && (
        <div className="rg-field__hint" role="status">
          {agentName} is running. Saving stops it; it starts again with the new text at your next
          message.
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      {tab !== "history" && (
        <div className="rg-office-agent__actions">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !dirty}
            onClick={() => void run(() => api.saveSoul(agentId, draft, soul.version))}
          >
            Save
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setDraft(soul.content)}
            >
              Undo my changes
            </Button>
          )}
          <span className="rg-muted">
            {draft.length} of {max} characters
            {soul.version > 0 ? ` · version ${soul.version}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
