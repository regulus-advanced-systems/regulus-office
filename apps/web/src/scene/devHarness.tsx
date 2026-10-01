/**
 * Dev-only page (`/scene.html` on the Vite dev server) that mounts the scene
 * without the HUD or networking, for eyeballing the room and measuring fps
 * (`/scene.html?stats`). `?template=<id>` picks the floor template
 * (`lobby`, `office-small`, `office-l2`, `office-large`; default lobby) and
 * `?palette=<id>` its palette (default: the lobby palette for the lobby,
 * the first floor palette otherwise). The local robot walks with click-to-walk / WASD
 * (moves are not sent anywhere); `V` (through the shared hotkey registry)
 * or the corner button toggles first person. Not part of the production
 * build (only index.html is an entry).
 */
import {
  LOBBY_PALETTE_ID,
  lobbyTemplate,
  paletteById,
  paletteForFloor,
  templateById,
} from "@regulus/room-layout";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useViewStore } from "../state/view.ts";
import { useGlobalHotkeys } from "../ui/hotkeys/useHotkeys.ts";
import { AvatarLayer } from "./avatars/AvatarLayer.tsx";
import { TemplateMovement } from "./movement/MovementController.tsx";
import { OfficeCanvas } from "./OfficeCanvas.tsx";

const noSend = () => {};

const params = new URLSearchParams(window.location.search);
const template = templateById(params.get("template") ?? "") ?? lobbyTemplate;
const palette =
  paletteById(params.get("palette") ?? "") ??
  (template.kind === "lobby" ? paletteById(LOBBY_PALETTE_ID) : paletteForFloor(0));

function Harness() {
  useGlobalHotkeys();
  const mode = useViewStore((s) => s.mode);
  const locked = useViewStore((s) => s.pointerLocked);
  const toggle = useViewStore((s) => s.toggle);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeCanvas template={template} palette={palette} avatars={<AvatarLayer />}>
        <TemplateMovement template={template} send={noSend} />
      </OfficeCanvas>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={mode === "first_person"}
        data-testid="harness-view-toggle"
        data-mode={mode}
        data-locked={locked}
        style={{ position: "absolute", right: 12, bottom: 12, zIndex: 2, font: "14px sans-serif" }}
      >
        {mode === "first_person" ? "Third person" : "First person"} (V)
      </button>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from scene.html");
createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
