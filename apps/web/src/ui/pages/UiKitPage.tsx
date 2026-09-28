/**
 * /ui-kit: every HUD component in every variant and state (issue #18), so
 * the GDT styling can be reviewed without Storybook. Dialogs and toasts
 * opened here use the real ui store, so the HUD dialogs are mounted too.
 */
import { HudDialogs } from "../Hud.tsx";
import { Toaster } from "../toast/Toaster.tsx";
import { ButtonsSection } from "./uiKit/ButtonsSection.tsx";
import { FeedbackSection } from "./uiKit/FeedbackSection.tsx";
import { HudSection } from "./uiKit/HudSection.tsx";
import { PanelsSection } from "./uiKit/PanelsSection.tsx";
import { TokensSection } from "./uiKit/TokensSection.tsx";

const SECTIONS = [
  ["tokens", "Tokens"],
  ["buttons", "Buttons"],
  ["panels", "Panels & modals"],
  ["feedback", "Toasts & settings"],
  ["hud", "HUD"],
] as const;

export function UiKitPage() {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 80px" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 36, fontWeight: 300 }}>Regulus UI kit</h1>
        <nav aria-label="Sections" style={{ display: "flex", gap: 12 }}>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} style={{ color: "var(--rg-color-blue)" }}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <TokensSection />
      <ButtonsSection />
      <PanelsSection />
      <FeedbackSection />
      <HudSection />
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} className="rg-hud">
          <Toaster />
        </div>
      </div>
      <HudDialogs />
    </main>
  );
}
