/**
 * Dev-only page (`/scene.html` on the Vite dev server) that mounts the scene
 * without the HUD or networking, for eyeballing the room and measuring fps
 * (`/scene.html?stats`). Not part of the production build (only index.html
 * is an entry).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OfficeCanvas } from "./OfficeCanvas.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from scene.html");
createRoot(root).render(
  <StrictMode>
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeCanvas />
    </div>
  </StrictMode>,
);
