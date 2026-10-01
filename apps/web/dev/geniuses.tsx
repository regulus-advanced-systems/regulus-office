// Dev-only entry (served by `vite` at /dev/geniuses.html; not part of the build).
// Query params: see src/scene/geniuses/showcase/GeniusShowcase.tsx. `clean=1` hides the stats box.
import { createRoot } from "react-dom/client";
import {
  GeniusShowcase,
  geniusShowcaseOptions,
} from "../src/scene/geniuses/showcase/GeniusShowcase.tsx";

if (new URLSearchParams(location.search).get("clean") === "1") document.body.classList.add("clean");
const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(<GeniusShowcase options={geniusShowcaseOptions(location.search)} />);
