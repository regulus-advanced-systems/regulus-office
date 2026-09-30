/**
 * HUD side of the boards (#36): the board panel, and a chip while the human
 * carries a card ("click a free desk", or put it back on the board).
 */
import { Button } from "../components/Button.tsx";
import type { BoardsApi } from "./api.ts";
import { BoardPanelHost } from "./BoardPanel.tsx";
import { dropCard, useMyCarried } from "./carry.ts";
import "../auth/auth.css";
import "./boards.css";

export function CarryChip() {
  const carried = useMyCarried();
  if (!carried) return null;
  const what = carried.kind === "pr" ? "PR" : "issue";
  return (
    <div className="rg-panel rg-carry" role="status" aria-label="Carried card">
      <span className="rg-carry__card" aria-hidden="true" />
      <span className="rg-carry__text">
        Carrying {what} <strong>#{carried.number}</strong>
        {carried.title ? ` ${carried.title}` : ""}. Click a free desk to spawn a robot on it.
      </span>
      <Button size="sm" variant="ghost" onClick={() => dropCard()}>
        Put back
      </Button>
    </div>
  );
}

export function BoardsHost({ api }: { api?: BoardsApi }) {
  return (
    <>
      <BoardPanelHost api={api} />
      <CarryChip />
    </>
  );
}
