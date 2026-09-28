import { colors, gradients, themeTokens } from "../../theme.ts";
import { Row, Section } from "./Section.tsx";

export function TokensSection() {
  return (
    <Section id="tokens" title="Design tokens">
      <Row label="Colours">
        {Object.entries(colors).map(([name, value]) => (
          <div key={name} style={{ display: "grid", justifyItems: "center", gap: 4, fontSize: 11 }}>
            <span
              title={value}
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: value,
                border: "1px solid rgba(0,0,0,0.15)",
              }}
            />
            <code>{name}</code>
            <code className="rg-muted">{value}</code>
          </div>
        ))}
      </Row>
      <Row label="Gradients">
        {Object.entries(gradients).map(([name, value]) => (
          <div key={name} style={{ display: "grid", justifyItems: "center", gap: 4, fontSize: 11 }}>
            <span style={{ width: 96, height: 32, borderRadius: 8, background: value }} />
            <code>{name}</code>
          </div>
        ))}
      </Row>
      <Row label="Type (Open Sans)">
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 32, fontWeight: 300 }}>Light 32 — titles</span>
          <span style={{ fontSize: 16, fontWeight: 400 }}>Regular 16 — body</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Semibold 14 — labels</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Bold 14 — values</span>
        </div>
      </Row>
      <Row label="CSS variables">
        <details>
          <summary>{Object.keys(themeTokens).length} custom properties (--rg-*)</summary>
          <pre style={{ fontSize: 11, margin: "6px 0 0" }}>
            {Object.entries(themeTokens)
              .map(([k, v]) => `--rg-${k}: ${v}`)
              .join("\n")}
          </pre>
        </details>
      </Row>
    </Section>
  );
}
