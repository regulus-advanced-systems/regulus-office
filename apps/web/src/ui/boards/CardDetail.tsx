/**
 * One card in the board panel (#36): title, state, repo, labels, people and
 * (PRs) branch, CI and review state; the markdown body and comments,
 * rendered sanitised (Markdown.tsx); "Carry to a desk"; and, for floor
 * managers, the write actions (CardActions).
 */
import type { BoardCardDetail } from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import {
  type BoardFailure,
  type BoardsApi,
  type CardRef,
  createBoardsApi,
  describeBoardFailure,
} from "./api.ts";
import { CardActions } from "./CardActions.tsx";
import { pickCard } from "./carry.ts";
import { checksBadge, reviewBadge } from "./columns.ts";
import { Markdown } from "./Markdown.tsx";

const defaultApi = createBoardsApi();

function stateLabel(d: BoardCardDetail): { text: string; tone: string } {
  if (d.merged) return { text: "Merged", tone: "blue" };
  if (d.state !== "open") return { text: "Closed", tone: "grey" };
  if (d.draft) return { text: "Draft", tone: "grey" };
  return { text: "Open", tone: "green" };
}

function when(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : "";
}

export function CardDetail({
  cardRef,
  summaryTitle,
  canCarry,
  onBack,
  onCarried,
  api = defaultApi,
}: {
  cardRef: CardRef;
  summaryTitle: string;
  canCarry: boolean;
  onBack: () => void;
  onCarried: () => void;
  api?: BoardsApi;
}) {
  const toast = useUiStore((s) => s.toast);
  const [detail, setDetail] = useState<BoardCardDetail | null>(null);
  const [failure, setFailure] = useState<BoardFailure | null>(null);
  const { floorId, kind, repoId, number } = cardRef;

  const load = useCallback(async () => {
    const res = await api.detail({ floorId, kind, repoId, number });
    if (res.ok) {
      setDetail(res.data);
      setFailure(null);
    } else setFailure(res);
  }, [api, floorId, kind, repoId, number]);

  useEffect(() => {
    void load();
  }, [load]);

  const carry = () => {
    // The HUD chip (BoardsHost) takes over from here.
    if (pickCard({ kind, repoId, number })) onCarried();
    else toast({ kind: "error", message: "Not connected to this operation." });
  };

  const title = detail?.title ?? summaryTitle;
  const badge = detail ? stateLabel(detail) : null;
  const checks = detail && kind === "pr" && !detail.merged ? checksBadge(detail.checksState) : null;
  const review = detail && kind === "pr" ? reviewBadge(detail.reviewState) : null;

  return (
    <article className="rg-card" aria-busy={!detail && !failure}>
      <div className="rg-card__nav">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← All cards
        </Button>
        {canCarry && (
          <Button variant="primary" size="sm" onClick={carry}>
            Carry to a desk
          </Button>
        )}
      </div>
      <h2 className="rg-card__title">
        <span className="rg-board__number">#{number}</span> {title}
      </h2>
      {failure && (
        <p role="alert" className="rg-card__error">
          {describeBoardFailure(failure)}
        </p>
      )}
      {!detail && !failure && <p className="rg-card__muted">Loading…</p>}
      {detail && (
        <>
          <div className="rg-card__meta">
            {badge && (
              <span className={`rg-board__badge rg-board__badge--${badge.tone}`}>{badge.text}</span>
            )}
            <span className="rg-board__chip">{detail.repo}</span>
            {detail.author && <span>by @{detail.author}</span>}
            {kind === "pr" && detail.headBranch && (
              <span className="rg-card__branch">
                {detail.headBranch} → {detail.baseBranch || "default"}
              </span>
            )}
            {checks && (
              <span className={`rg-board__badge rg-board__badge--${checks.tone}`}>
                {checks.label}
              </span>
            )}
            {review && (
              <span className={`rg-board__badge rg-board__badge--${review.tone}`}>
                {review.label}
              </span>
            )}
          </div>
          <div className="rg-card__meta">
            {detail.labels.map((l) => (
              <span key={l} className="rg-card__label">
                {l}
              </span>
            ))}
            <span className="rg-card__muted">
              {detail.assignees.length > 0
                ? `Assigned to ${detail.assignees.map((a) => `@${a}`).join(", ")}`
                : "Nobody assigned"}
            </span>
            {detail.url.startsWith("https://") && (
              <a
                href={detail.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Open on GitHub
              </a>
            )}
          </div>

          <section className="rg-card__body" aria-label="Description">
            <Markdown source={detail.bodyMd} />
          </section>

          <section aria-label="Comments" className="rg-card__comments">
            <h3 className="rg-card__section">Comments</h3>
            {detail.commentsError && <p className="rg-card__muted">{detail.commentsError}</p>}
            {!detail.commentsError && detail.comments.length === 0 && (
              <p className="rg-card__muted">No comments yet.</p>
            )}
            <ol className="rg-card__comment-list">
              {detail.comments.map((c) => (
                <li key={c.id} className="rg-card__comment">
                  <div className="rg-card__comment-head">
                    <strong>@{c.author || "ghost"}</strong>{" "}
                    <span className="rg-card__muted">{when(c.createdAt)}</span>
                  </div>
                  <Markdown source={c.bodyMd} empty="(empty)" />
                </li>
              ))}
            </ol>
          </section>

          {detail.canWrite && (
            <CardActions api={api} cardRef={cardRef} detail={detail} onChanged={load} />
          )}
        </>
      )}
    </article>
  );
}
