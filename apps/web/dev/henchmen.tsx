// Dev-only entry (served by `vite` at /dev/henchmen.html; not part of the build).
// Query params: view=skins|trims|heads|lights|secretary|poses|crowd|thumbs n=<crowd> zoom=<ortho zoom> cam=iso anim= status=
// view=thumbs shows the gallery thumbnails (#225) of every form in two trims, as the pickers draw them.
import { CHARACTER_FORM_IDS, CHARACTER_FORM_LABELS } from "@regulus/protocol";
import { createRoot } from "react-dom/client";
import { providerLightColor } from "../src/scene/avatar/colorSets.ts";
import { HenchmenShowcase } from "../src/scene/henchmen/dev/HenchmenShowcase.tsx";
import { SkinThumb } from "../src/ui/settings/SkinThumb.tsx";
import "../src/ui/globals.css";
import "../src/ui/settings/skinRules.css";

function Thumbs() {
  return (
    <div style={{ display: "flex", gap: 16, padding: 32, flexWrap: "wrap", zoom: 2 }}>
      {(["claude-code", "codex"] as const).flatMap((provider) =>
        CHARACTER_FORM_IDS.map((id) => (
          <figure key={`${provider}-${id}`} style={{ margin: 0, textAlign: "center" }}>
            <SkinThumb skin={id} trim={providerLightColor(provider)} />
            <figcaption style={{ fontSize: 9, marginTop: 4, color: "#333" }}>
              {CHARACTER_FORM_LABELS[id]}
            </figcaption>
          </figure>
        )),
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
const thumbs = new URLSearchParams(location.search).get("view") === "thumbs";
createRoot(root).render(thumbs ? <Thumbs /> : <HenchmenShowcase search={location.search} />);
