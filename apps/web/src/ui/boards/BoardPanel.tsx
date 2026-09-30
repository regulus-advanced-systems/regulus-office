/**
 * The GDT-style 2D panel for an issue or PR board (SPEC §9.4; #36): the
 * board's columns with their cards; a card opens its detail (CardDetail).
 * Opened from the 3D board (click or `E`); cards come from the FloorRoom
 * state (#35 summaries), so the panel updates live.
 */
import type { CardKind, IssueCard, PullCard, RepoSummary, RobotState } from "@regulus/protocol";
import { hasFloorAccess } from "@regulus/protocol";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
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
const NO_ROBOTS: Readonly<Record<string, RobotState>> = {};

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
        No cards yet. They appear once the office's GitHub connection has synced this floor's repos.
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
  const floorId = useFloorStore((s) => s.floorId);
  const board = useFloorStore(
    useShallow((s) => ({
      issues: s.state?.issues ?? NO_ISSUES,
      pulls: s.state?.pulls ?? NO_PULLS,
      repos: s.state?.repos ?? NO_REPOS,
      robots: s.state?.robots ?? NO_ROBOTS,
    })),
  );
  const access = useFloorsStore((s) => s.floors?.find((f) => f.floorId === floorId)?.access);
  const columns = useMemo(
    () =>
      buildBoard(kind, {
        issues: board.issues,
        pulls: board.pulls,
        repos: board.repos,
        robots: Object.values(board.robots),
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
      {selected && floorId ? (
        <CardDetail
          key={selected}
          api={api}
          cardRef={{
            floorId,
            kind,
            repoId: card?.repoId ?? selected.split("#")[0] ?? "",
            number: card?.number ?? Number(selected.split("#")[1]),
          }}
          summaryTitle={card?.title ?? ""}
          canCarry={hasFloorAccess(access ?? null, "spawn")}
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
  const floorId = useFloorStore((s) => s.floorId);
  const closeBoard = useBoardStore((s) => s.closeBoard);
  useEffect(() => {
    if (!open) return;
    openOverlay(BOARD_OVERLAY);
    return () => closeOverlay(BOARD_OVERLAY);
  }, [open, openOverlay, closeOverlay]);
  // Leaving the floor closes its board.
  useEffect(() => {
    closeBoard();
  }, [floorId, closeBoard]);
  return open ? <BoardPanel kind={open} api={api} /> : null;
}
