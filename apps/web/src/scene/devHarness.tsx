/**
 * Dev-only page (`/scene.html` on the Vite dev server) that mounts the scene
 * without the HUD or networking, for eyeballing the room and measuring fps
 * (`/scene.html?stats`). `V` (through the shared hotkey registry) or the
 * corner button toggles first person. Not part of the production build
 * (only index.html is an entry).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useViewStore } from "../state/view.ts";
import { useGlobalHotkeys } from "../ui/hotkeys/useHotkeys.ts";
import { OfficeCanvas } from "./OfficeCanvas.tsx";

function Harness() {
  useGlobalHotkeys();
  const mode = useViewStore((s) => s.mode);
  const locked = useViewStore((s) => s.pointerLocked);
  const toggle = useViewStore((s) => s.toggle);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeCanvas />
      <button
        type="button"
        onClick={toggle}
        aria-pressed={mode === "first_person"}
        data-testid="harness-view-toggle"
        data-mode={mode}
        data-locked={locked}
        style={{ position: "absolute", left: 12, bottom: 12, zIndex: 2, font: "14px sans-serif" }}
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
