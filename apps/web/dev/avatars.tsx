// Dev-only entry (served by `vite` at /dev/avatars.html; not part of the build).
// Query params: n=<robots> zoom=<ortho zoom> shadows=0 probe=1
import { createRoot } from "react-dom/client";
import {
  AvatarShowcase,
  showcaseOptionsFrom,
} from "../src/scene/avatar/showcase/AvatarShowcase.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(<AvatarShowcase options={showcaseOptionsFrom(location.search)} />);
