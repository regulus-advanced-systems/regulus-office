// Dev-only entry (served by `vite` at /dev/robots.html; not part of the build).
// Query params: n=<robots> mode=working|mixed|waiting|idle|flap rate=<ticks/s> reduced=1
import { createRoot } from "react-dom/client";
import { RobotsHarness } from "../src/scene/robots/dev/RobotsHarness.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(<RobotsHarness search={location.search} />);
