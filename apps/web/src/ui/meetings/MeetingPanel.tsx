/**
 * The meeting room panel (#50): the room's meetings, and one meeting live:
 * agenda progress, budget, members with their lamps, who has the floor, the
 * transcript and the output. Everyone with access to the room watches; the
 * starter pauses, resumes and stops; an office owner/admin only has the
 * emergency stop (D12).
 */
import {
  isLiveMeeting,
  MEETING_PATTERN_LABELS,
  MEETING_TURN_LABELS,
  type MeetingAction,
  type MeetingDetail,
  type MeetingStatus,
  type MeetingSummary,
  type ProviderId,
} from "@regulus/protocol";
import { useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { findModel, providerPreset } from "../spawn/models.ts";
import { createMeetingsApi, describeMeetingError, type MeetingsApi } from "./api.ts";
import { OUTPUT_LABELS, tokens } from "./meetingForm.ts";
import { useMeetingStore } from "./meetingStore.ts";

const defaultApi = createMeetingsApi();

/** "Claude Code · Opus"; ids as they are when the presets do not know them. */
export function modelLabel(provider: ProviderId, model: string): string {
  const p = providerPreset(provider);
  return `${p?.label ?? provider} · ${findModel(provider, model)?.label ?? model}`;
}

export const STATUS_LABELS: Readonly<Record<MeetingStatus, string>> = {
  starting: "Convening",
  running: "In session",
  paused: "Paused",
  done: "Adjourned",
  stopped: "Stopped",
  failed: "Failed",
};

function StatusChip({ status }: { status: MeetingStatus }) {
  return (
    <span className={`rg-meeting__status rg-meeting__status--${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function Budget({ m }: { m: MeetingSummary }) {
  const pct = m.tokenBudget > 0 ? Math.min(100, (m.tokensUsed / m.tokenBudget) * 100) : 0;
  return (
    <div className="rg-meeting__budget">
      <div
        className="rg-meeting__meter"
        role="meter"
        aria-label="Token budget used"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${pct}%` }} data-high={pct >= 80 || undefined} />
      </div>
      <span className="rg-meeting__meta">
        {tokens(m.tokensUsed)} of {tokens(m.tokenBudget)} tokens
      </span>
    </div>
  );
}

function Members({ m }: { m: MeetingSummary }) {
  return (
    <ul className="rg-meeting__members">
      {m.members.map((member) => {
        const speaking = m.speaking.includes(member.position);
        return (
          <li
            key={member.position}
            className="rg-meeting__member"
            data-speaking={speaking || undefined}
          >
            <span
              className={`rg-meeting__lamp rg-meeting__lamp--${member.status}`}
              aria-hidden="true"
            />
            <strong>{member.name}</strong>
            <span className="rg-meeting__meta">{modelLabel(member.provider, member.model)}</span>
            {speaking && <span className="rg-meeting__floor">has the floor</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Transcript({ detail }: { detail: MeetingDetail }) {
  const names = new Map(detail.members.map((m) => [m.position, m.name]));
  if (detail.turns.length === 0) {
    return <p className="rg-meeting__meta">No turns yet: the henchmen are taking their seats.</p>;
  }
  // The latest notes stay open, and whoever is speaking; earlier turns fold away.
  const lastDone = detail.turns.findLastIndex((t) => t.status === "done");
  return (
    <ol className="rg-meeting__turns">
      {detail.turns.map((t, i) => (
        <li
          key={`${t.step}-${t.position}`}
          className={`rg-meeting__turn rg-meeting__turn--${t.status}`}
        >
          <details open={i === lastDone || t.status === "running"}>
            <summary>
              <span className="rg-meeting__meta">Round {t.round}</span>{" "}
              <strong>{names.get(t.position) ?? "?"}</strong> {MEETING_TURN_LABELS[t.kind]}
              {t.status === "running" && <span className="rg-meeting__floor">speaking…</span>}
              {t.status === "failed" && <span className="rg-meeting__failed">interrupted</span>}
              {t.tokens > 0 && (
                <span className="rg-meeting__meta"> · {tokens(t.tokens)} tokens</span>
              )}
            </summary>
            {t.text ? <div className="rg-meeting__text">{t.text}</div> : null}
          </details>
        </li>
      ))}
    </ol>
  );
}

function Detail({
  m,
  detail,
  api,
}: {
  m: MeetingSummary;
  detail: MeetingDetail | null;
  api: MeetingsApi;
}) {
  const [pending, setPending] = useState<MeetingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: MeetingAction) => {
    setPending(action);
    setError(null);
    const res = await api.act(m.id, action);
    setPending(null);
    if (res.ok) useMeetingStore.getState().applyChanged(res.data);
    else setError(describeMeetingError(res));
  };
  const live = isLiveMeeting(m.status);
  return (
    <div className="rg-meeting">
      <div className="rg-meeting__head">
        <StatusChip status={m.status} />
        <strong>{MEETING_PATTERN_LABELS[m.pattern]}</strong>
        <span className="rg-meeting__meta">
          round {m.round} of {m.rounds} · step {Math.min(m.step + (live ? 1 : 0), m.steps)} of{" "}
          {m.steps}
        </span>
      </div>
      <p className="rg-meeting__topic">{m.title}</p>
      <p className="rg-meeting__meta">
        Called by {m.starterName || "someone"} · {OUTPUT_LABELS[m.output]}
        {m.prNumber > 0 ? ` #${m.prNumber}` : ""}
        {m.branch ? ` · ${m.branch}` : ""}
      </p>
      <Budget m={m} />
      <Members m={m} />
      {m.reason && <p className="rg-meeting__reason">{m.reason}</p>}
      {m.outputUrl && (
        <p>
          <a href={m.outputUrl} target="_blank" rel="noreferrer noopener">
            {m.output === "pr_review" ? "Open the review" : "Open the pull request"}
          </a>
        </p>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      {detail && (detail.canControl || detail.canEmergencyStop) && live && (
        <div className="rg-meeting__actions">
          {detail.canControl && m.status !== "paused" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending !== null}
              onClick={() => void act("pause")}
            >
              Pause
            </Button>
          )}
          {detail.canControl && m.status === "paused" && (
            <Button
              size="sm"
              variant="primary"
              disabled={pending !== null}
              onClick={() => void act("resume")}
            >
              Resume
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            disabled={pending !== null}
            onClick={() => void act("stop")}
          >
            {detail.canControl ? "Stop meeting" : "Emergency stop"}
          </Button>
        </div>
      )}
      <section aria-label="Transcript" className="rg-meeting__section">
        <h3 className="rg-meeting__heading">Transcript</h3>
        {detail ? <Transcript detail={detail} /> : <p className="rg-meeting__meta">Loading…</p>}
      </section>
    </div>
  );
}

function List({ meetings, canStart }: { meetings: MeetingSummary[]; canStart: boolean }) {
  const open = useMeetingStore((s) => s.openPanel);
  const openStart = useMeetingStore((s) => s.openStart);
  const live = meetings.some((m) => isLiveMeeting(m.status));
  return (
    <div className="rg-meeting">
      <p className="rg-meeting__intro">
        Two to five of your henchmen work on one task together, in turns, in a shared worktree, and
        end with a draft pull request, a review or notes. Everyone in the room can watch.
      </p>
      {canStart && !live && (
        <Button variant="primary" onClick={openStart}>
          Call a meeting…
        </Button>
      )}
      {meetings.length === 0 ? (
        <p className="rg-meeting__meta">No meetings in this room yet.</p>
      ) : (
        <ul className="rg-meeting__list">
          {meetings.map((m) => (
            <li key={m.id}>
              <button type="button" className="rg-meeting__item" onClick={() => open(m.id)}>
                <StatusChip status={m.status} />
                <span className="rg-meeting__item-title">{m.title}</span>
                <span className="rg-meeting__meta">
                  {MEETING_PATTERN_LABELS[m.pattern]} · {m.starterName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MeetingPanel({ api = defaultApi }: { api?: MeetingsApi }) {
  const panel = useMeetingStore((s) => s.panel);
  const list = useMeetingStore((s) => s.list);
  const active = useMeetingStore((s) => s.active);
  const detail = useMeetingStore((s) => s.detail);
  const close = useMeetingStore((s) => s.closePanel);
  const back = useMeetingStore((s) => s.openPanel);
  if (!panel) return null;
  const id = panel.meetingId;
  const summary =
    (id &&
      (active[id] ??
        list?.meetings.find((m) => m.id === id) ??
        (detail?.id === id ? detail : undefined))) ||
    undefined;
  return (
    <Modal
      open
      onClose={close}
      title={id ? "Meeting" : "Meeting room"}
      width={720}
      footer={
        id ? (
          <Button variant="secondary" onClick={() => back(null)}>
            All meetings
          </Button>
        ) : undefined
      }
    >
      {id && summary ? (
        <Detail m={summary} detail={detail?.id === id ? detail : null} api={api} />
      ) : id ? (
        <p className="rg-meeting__meta">Loading…</p>
      ) : (
        <List meetings={list?.meetings ?? []} canStart={list?.canStart ?? false} />
      )}
    </Modal>
  );
}
