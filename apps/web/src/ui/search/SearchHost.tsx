/**
 * Search (#41), mounted once in the HUD: `/` opens the dialog, and a jump
 * to a robot's desk started from a result is driven from here.
 */
import { useCallback } from "react";
import { useUiStore } from "../../state/ui.ts";
import { useHotkeyEvents } from "../hotkeys/useHotkeys.ts";
import type { SearchApi } from "./api.ts";
import { SearchPanel } from "./SearchPanel.tsx";
import { SEARCH_OVERLAY_ID } from "./searchStore.ts";
import { useSearchJump } from "./useSearchJump.ts";

export const SEARCH_HOTKEY_ID = "search";

export function SearchHost({ api }: { api?: SearchApi }) {
  const openOverlay = useUiStore((s) => s.openOverlay);
  useHotkeyEvents(
    useCallback(
      (detail: { id: string }) => {
        if (detail.id === SEARCH_HOTKEY_ID) openOverlay(SEARCH_OVERLAY_ID);
      },
      [openOverlay],
    ),
  );
  useSearchJump();
  return <SearchPanel api={api} />;
}
