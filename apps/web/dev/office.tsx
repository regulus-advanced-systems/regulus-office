// Dev-only entry (served by `vite` at /dev/office.html; not part of the build).
// Query params: n=<henchmen> mode=working|mixed|waiting|idle|flap rate=<ticks/s> reduced=1
// Blast door and outside (#188): door=open|closing|closed|alarm doorAfter=<ms> at=lobby|beach|dock
import { createRoot } from "react-dom/client";
import { HenchmenHarness } from "../src/scene/henchmen/dev/HenchmenHarness.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(<HenchmenHarness search={location.search} />);
