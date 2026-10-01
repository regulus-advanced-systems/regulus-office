// Dev-only entry (served by `vite` at /dev/lair.html; not part of the build): the lair art kit (#183).
// Query params: view=overview|corner|junction|door|console|scaffold|pieces|lounge door=open|closed
// alarm=1 cut=0 labels=0 stats=0. Keys: O toggles the doors, A the alarm.
import { createRoot } from "react-dom/client";
import { LairShowcase } from "../src/scene/lair/debug/LairShowcase.tsx";
import { showcaseOptions } from "../src/scene/lair/debug/views.ts";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(<LairShowcase options={showcaseOptions(location.search)} />);
