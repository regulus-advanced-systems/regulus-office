/**
 * The GDT-style 2D panel for an issue or PR board (SPEC §9.4; #36): the
 * board's columns with their cards; a card opens its detail (CardDetail).
 * Opened from the 3D board (click or `E`); cards come from the OperationRoom
 * state (#35 summaries), so the panel updates live.
 */
import type { CardKind, HenchmanState, IssueCard, PullCard, RepoSummary } from "@regulus/protocol";
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

function Badge({ tone, children }: { tone: string; children: string }) {
  return <span className={`rg-board__badge rg-board__badge--${tone}`}>{children}</span>;
}

function CardButton({ card, onOpen }: { card: BoardCardView; onOpen: (key: string) => void }) {
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
        <span className="rg-board__card-title">{card.title}</span>
        <span className="rg-board__card-foot">
          {card.checks && <Badge tone={card.checks.tone}>{card.checks.label}</Badge>}
          {card.review && <Badge tone={card.review.tone}>{card.review.label}</Badge>}
          {card.assignees.length > 0 && (
            <span className="rg-board__people">{card.assignees.map((a) => `@${a}`).join(" ")}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Columns({
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
    <div className="rg-board__columns" style={{ "--rg-board-cols": columns.length } as never}>
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
    </div>
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
      }),
    [kind, board],
  );
  const card = selected ? (kind === "pr" ? board.pulls[selected] : board.issues[selected]) : null;

  return (
    <Modal
      open
      onClose={closeBoard}
      title={BOARD_TITLES[kind]}
      width={selected ? 720 : Math.max(640, columns.length * 220)}
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
        <Columns columns={columns} onOpen={selectCard} />
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
