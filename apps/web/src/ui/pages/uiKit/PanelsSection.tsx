import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { Panel } from "../../Panel.tsx";
import { Row, Section } from "./Section.tsx";

export function PanelsSection() {
  const [open, setOpen] = useState<"basic" | "danger" | null>(null);
  return (
    <Section id="panels" title="Panels and modals">
      <Row label="panel">
        <Panel style={{ width: 220 }}>Plain panel</Panel>
        <Panel title="Titled" style={{ width: 220 }}>
          With a heading
        </Panel>
        <Panel muted style={{ width: 220 }}>
          Muted (No Project)
        </Panel>
        <Panel flush style={{ width: 220 }}>
          <div style={{ padding: 8 }}>Flush padding</div>
        </Panel>
      </Row>
      <Row label="modal (inline)">
        <div style={{ width: "100%" }}>
          <Modal inline open onClose={() => {}} title="Inline preview" width={440}>
            Static preview of the golden-bordered dialog on #FFF9EF with the cream glow.
          </Modal>
        </div>
      </Row>
      <Row label="modal (footer)">
        <div style={{ width: "100%" }}>
          <Modal
            inline
            open
            onClose={() => {}}
            title="Stop robot Ada?"
            width={440}
            footer={
              <>
                <Button variant="secondary">Cancel</Button>
                <Button variant="destructive">Stop robot</Button>
              </>
            }
          >
            Destructive confirmation: primary action on the right is red.
          </Modal>
        </div>
      </Row>
      <Row label="modal (live)">
        <Button variant="primary" onClick={() => setOpen("basic")}>
          Open modal
        </Button>
        <Button variant="destructive" onClick={() => setOpen("danger")}>
          Open destructive modal
        </Button>
        <span className="rg-muted" style={{ fontSize: 12 }}>
          Tab cycles inside, Esc closes, focus returns to the button.
        </span>
      </Row>
      <Modal
        open={open === "basic"}
        onClose={() => setOpen(null)}
        title="Live modal"
        footer={
          <Button variant="primary" onClick={() => setOpen(null)}>
            OK
          </Button>
        }
      >
        <p style={{ marginTop: 0 }}>Try Tab / Shift+Tab: focus stays within the dialog.</p>
        <input placeholder="A text field" aria-label="A text field" />
      </Modal>
      <Modal
        open={open === "danger"}
        onClose={() => setOpen(null)}
        title="Delete floor?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => setOpen(null)}>
              Delete
            </Button>
          </>
        }
      >
        This cannot be undone.
      </Modal>
    </Section>
  );
}
