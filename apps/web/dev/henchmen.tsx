// Dev-only entry (served by `vite` at /dev/henchmen.html; not part of the build).
// Query params: view=skins|trims|poses|crowd n=<crowd> zoom=<ortho zoom> cam=iso anim= status=
import { createRoot } from "react-dom/client";
import { HenchmenShowcase } from "../src/scene/henchmen/dev/HenchmenShowcase.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(<HenchmenShowcase search={location.search} />);
