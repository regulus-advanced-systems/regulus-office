import { selectReducedMotion, useUiStore } from "../../../state/ui.ts";
import { Button } from "../../components/Button.tsx";
import { Panel } from "../../Panel.tsx";
import { SettingsForm } from "../../settings/SettingsPanel.tsx";
import { ToastCard } from "../../toast/Toaster.tsx";
import type { Toast, ToastKind } from "../../toast/toastQueue.ts";
import { Row, Section } from "./Section.tsx";

const KINDS: ToastKind[] = ["info", "success", "warning", "error"];

const sample = (kind: ToastKind, i: number): Toast => ({
  id: `sample-${i}`,
  kind,
  title: `${kind[0]?.toUpperCase()}${kind.slice(1)} toast`,
  message:
    kind === "error" ? "Sticky until dismissed." : `Auto-dismisses; ${kind} styling with an icon.`,
  durationMs: 0,
  // The info sample shows the button a "needs you" notification carries (#256).
  open: kind === "info" ? { label: "Take me there", run: () => {} } : undefined,
  createdAt: 0,
  shownAt: 0,
});

export function FeedbackSection() {
  const toast = useUiStore((s) => s.toast);
  const clear = useUiStore((s) => s.clearToasts);
  const reducedMotion = useUiStore(selectReducedMotion);
  return (
    <Section id="feedback" title="Toasts and settings">
      <Row label="toast cards">
        <div style={{ display: "grid", gap: 8, width: 360 }}>
          {KINDS.map((kind, i) => (
            <ToastCard
              key={kind}
              toast={sample(kind, i)}
              onDismiss={() => {}}
              reducedMotion={reducedMotion}
            />
          ))}
        </div>
      </Row>
      <Row label="toast queue (live)">
        {KINDS.map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            size="sm"
            onClick={() => toast({ kind, message: `A ${kind} toast` })}
          >
            push {kind}
          </Button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            for (let i = 1; i <= 5; i++) toast({ message: `Burst ${i} of 5`, durationMs: 2500 });
          }}
        >
          push 5 (max 3 visible)
        </Button>
        <Button variant="ghost" size="sm" onClick={clear}>
          clear
        </Button>
      </Row>
      <Row label="settings form">
        <Panel style={{ width: 420 }}>
          <SettingsForm />
        </Panel>
      </Row>
    </Section>
  );
}
