/**
 * HUD side of the room's bookshelf (#264), mounted once: the reader, which
 * owns the keyboard while open (so no hotkey reaches the scene, and the
 * shelf's own `E` comes through the hotkey registry, which already ignores
 * presses in a terminal, a text field or the whiteboard). Leaving the room
 * closes it.
 */
import { useEffect } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { useUiStore } from "../../state/ui.ts";
import type { BookshelfApi } from "./api.ts";
import { BookshelfPanel } from "./BookshelfPanel.tsx";
import { BOOKSHELF_OVERLAY, useBookshelfStore } from "./bookshelfStore.ts";
import "./bookshelf.css";

export function BookshelfHost({ api }: { api?: BookshelfApi }) {
  const open = useBookshelfStore((s) => s.operationId !== null);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const room = useOperationStore((s) => s.operationId);
  useEffect(() => {
    if (!open) return;
    openOverlay(BOOKSHELF_OVERLAY);
    return () => closeOverlay(BOOKSHELF_OVERLAY);
  }, [open, openOverlay, closeOverlay]);
  useEffect(() => {
    // Another room (or none): the shelf that was open belongs to the room left behind.
    const shelf = useBookshelfStore.getState();
    if (shelf.operationId !== null && shelf.operationId !== room) shelf.close();
  }, [room]);
  return open ? <BookshelfPanel api={api} /> : null;
}
