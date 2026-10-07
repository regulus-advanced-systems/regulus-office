/**
 * The GDT-style 2D panel for an issue or PR board (SPEC §9.4; #36): the
 * board's columns with their cards; a card opens its detail (CardDetail).
 * Opened from the 3D board (click or `E`); cards come from the OperationRoom
 * state (#35 summaries), so the panel updates live.
 */
import type {
  CardKind,
  HenchmanState,
  IssueCard,
  PullCard,
  QueueTask,
  RepoSummary,
} from "@regulus/protocol";
import { hasOperationAccess } from "@regulus/protocol";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useUiStore } from "../../state/ui.ts";
import { Modal } from "../components/Modal.tsx";
import type { BoardsApi } from "./api.ts";
import { BOARD_OVERLAY, useBoardStore } from "./boardStore.ts";
import { CardDetail } from "./CardDetail.tsx";
import { BOARD_TITLES, type BoardCardView, type BoardColumnView, buildBoard } from "./columns.ts";
import "./boards.css";

const NO_ISSUES: Readonly<Record<string, IssueCard>> = {};
const NO_PULLS: Readonly<Record<string, PullCard>> = {};
const NO_REPOS: readonly RepoSummary[] = [];
const NO_HENCHMEN: Readonly<Record<string, HenchmanState>> = {};
const NO_QUEUE: readonly QueueTask[] = [];

/** Width a column gets when the window has it; a card title then fits on two or three lines. */
export const BOARD_COLUMN_WIDTH = 340;
/** Gap between columns (boards.css) and the dialog's own padding and frame. */
const BOARD_COLUMN_GAP = 12;
const BOARD_CHROME = 64;
const BOARD_MIN_WIDTH = 960;
/** A card's detail reads best as one column of text. */
const BOARD_DETAIL_WIDTH = 860;

/**
 * The board window's width (#282): every column at `BOARD_COLUMN_WIDTH`. The
 * dialog never grows past the screen (Modal caps it), and when the screen is
 * narrower the columns keep a readable minimum and scroll sideways instead
 * of squeezing (boards.css).
 */
export function boardPanelWidth(columns: number, detail: boolean): number {
  if (detail) return BOARD_DETAIL_WIDTH;
  const wanted = columns * BOARD_COLUMN_WIDTH + (columns - 1) * BOARD_COLUMN_GAP + BOARD_CHROME;
  return Math.max(BOARD_MIN_WIDTH, wanted);
}

function Badge({ tone, children }: { tone: string; children: string }) {
  return <span className={`rg-board__badge rg-board__badge--${tone}`}>{children}</span>;
}

export function CardButton({
  card,
  onOpen,
}: {
  card: BoardCardView;
  onOpen: (key: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="rg-board__card"
        onClick={() => onOpen(card.key)}
        aria-label={`#${card.number} ${card.title}`}
      >
        <span className="rg-board__card-head">
          <span className="rg-board__number">#{card.number}</span>
          {card.repoChip && <span className="rg-board__chip">{card.repoChip}</span>}
        </span>
        <span className="rg-board__card-title" title={card.title}>
          {card.title}
        </span>
        {card.labels.length > 0 && (
          <span className="rg-board__labels" aria-label="Labels">
            {card.labels.map((l) => (
              <span key={l} className="rg-board__label">
                {l}
              </span>
            ))}
          </span>
        )}
        <span className="rg-board__card-foot">
          {card.queued && <Badge tone="amber">Queued</Badge>}
          {card.checks && <Badge tone={card.checks.tone}>{card.checks.label}</Badge>}
          {card.review && <Badge tone={card.review.tone}>{card.review.label}</Badge>}
          {card.assignees.length > 0 && (
            <span className="rg-board__people" aria-label="Assignees">
              {card.assignees.map((a) => `@${a}`).join(" ")}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export function BoardColumns({
  columns,
  onOpen,
}: {
  columns: BoardColumnView[];
  onOpen: (key: string) => void;
}) {
  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  if (total === 0) {
    return (
      <p className="rg-board__empty">
        No cards yet. They appear once the office's GitHub connection has synced this operation's
        repos.
      </p>
    );
  }
  return (
    <section
      className="rg-board__columns"
      aria-label="Columns"
      // Scrolls sideways on a narrow screen: reachable by keyboard too.
      tabIndex={0}
      style={{ "--rg-board-cols": columns.length } as never}
    >
      {columns.map((col) => (
        <section key={col.id} className="rg-board__column" aria-label={col.title}>
          <h2 className="rg-board__column-title">
            {col.title} <span className="rg-board__count">{col.cards.length}</span>
          </h2>
          <ul className="rg-board__cards">
            {col.cards.map((card) => (
              <CardButton key={card.key} card={card} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

export function BoardPanel({ kind, api }: { kind: CardKind; api?: BoardsApi }) {
  const selected = useBoardStore((s) => s.selected);
  const selectCard = useBoardStore((s) => s.selectCard);
  const closeBoard = useBoardStore((s) => s.closeBoard);
  const operationId = useOperationStore((s) => s.operationId);
  const board = useOperationStore(
    useShallow((s) => ({
      issues: s.state?.issues ?? NO_ISSUES,
      pulls: s.state?.pulls ?? NO_PULLS,
      repos: s.state?.repos ?? NO_REPOS,
      henchmen: s.state?.henchmen ?? NO_HENCHMEN,
      queue: s.state?.queue ?? NO_QUEUE,
    })),
  );
  const access = useOperationsStore(
    (s) => s.operations?.find((f) => f.operationId === operationId)?.access,
  );
  const columns = useMemo(
    () =>
      buildBoard(kind, {
        issues: board.issues,
        pulls: board.pulls,
        repos: board.repos,
        henchmen: Object.values(board.henchmen),
        queue: board.queue,
      }),
    [kind, board],
  );
  const card = selected ? (kind === "pr" ? board.pulls[selected] : board.issues[selected]) : null;

  return (
    <Modal
      open
      onClose={closeBoard}
      title={BOARD_TITLES[kind]}
      width={boardPanelWidth(columns.length, Boolean(selected))}
    >
      {selected && operationId ? (
        <CardDetail
          key={selected}
          api={api}
          cardRef={{
            operationId,
            kind,
            repoId: card?.repoId ?? selected.split("#")[0] ?? "",
            number: card?.number ?? Number(selected.split("#")[1]),
          }}
          summaryTitle={card?.title ?? ""}
          canCarry={hasOperationAccess(access ?? null, "spawn")}
          onBack={() => selectCard(null)}
          onCarried={closeBoard}
        />
      ) : (
        <BoardColumns columns={columns} onOpen={selectCard} />
      )}
    </Modal>
  );
}

/** Mounts the open board's panel and claims the keyboard overlay while it is up. */
export function BoardPanelHost({ api }: { api?: BoardsApi }) {
  const open = useBoardStore((s) => s.open);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const operationId = useOperationStore((s) => s.operationId);
  const closeBoard = useBoardStore((s) => s.closeBoard);
  useEffect(() => {
    if (!open) return;
    openOverlay(BOARD_OVERLAY);
    return () => closeOverlay(BOARD_OVERLAY);
  }, [open, openOverlay, closeOverlay]);
  // Leaving the operation closes its board.
  useEffect(() => {
    closeBoard();
  }, [operationId, closeBoard]);
  return open ? <BoardPanel kind={open} api={api} /> : null;
}
