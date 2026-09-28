import { Button, type ButtonSize, type ButtonVariant } from "../../components/Button.tsx";
import { CloseButton } from "../../components/CloseButton.tsx";
import { GearIcon } from "../../components/icons.tsx";
import { Switch } from "../../components/Switch.tsx";
import { Row, Section } from "./Section.tsx";

const VARIANTS: ButtonVariant[] = ["primary", "destructive", "secondary", "ghost"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

export function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons and controls">
      {VARIANTS.map((variant) => (
        <Row key={variant} label={variant}>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              {size}
            </Button>
          ))}
          <Button variant={variant} icon={<GearIcon />}>
            icon
          </Button>
          <Button variant={variant} disabled>
            disabled
          </Button>
        </Row>
      ))}
      <Row label="block">
        <Button variant="primary" block>
          Full width
        </Button>
      </Row>
      <Row label="close">
        <CloseButton /> <CloseButton small />
      </Row>
      <Row label="switch">
        <Switch checked={false} onChange={() => {}} label="Off" />
        <Switch checked onChange={() => {}} label="On" hint="With a hint" />
        <Switch checked disabled onChange={() => {}} label="Disabled" />
      </Row>
      <Row label="range">
        <input className="rg-range" type="range" defaultValue={60} aria-label="Range example" />
      </Row>
      <Row label="kbd">
        <kbd className="rg-kbd">F</kbd> <kbd className="rg-kbd">Esc</kbd>
      </Row>
    </Section>
  );
}
