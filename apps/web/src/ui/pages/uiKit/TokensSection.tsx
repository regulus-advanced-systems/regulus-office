import { lairAccents, lampColors, uiSchemes } from "../../theme/lairPalette.ts";
import { lampStyle } from "../../theme/lamps.ts";
import { gradients, themeTokens } from "../../theme.ts";
import { Row, Section } from "./Section.tsx";

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 4, fontSize: 11 }}>
      <span
        title={value}
        style={{
          width: 44,
          height: 44,
          borderRadius: 6,
          background: value,
          border: "2px solid var(--rg-color-gold)",
        }}
      />
      <code>{name}</code>
      <code className="rg-muted">{value}</code>
    </div>
  );
}

export function TokensSection() {
  return (
    <Section id="tokens" title="Design tokens">
      <Row label="Lair accents (SPEC §12)">
        {Object.entries(lairAccents).map(([name, value]) => (
          <Swatch key={name} name={name} value={value} />
        ))}
      </Row>
      {Object.entries(uiSchemes).map(([scheme, values]) => (
        <Row key={scheme} label={`${scheme} scheme`}>
          {Object.entries(values)
            .filter(([, v]) => v.startsWith("#"))
            .map(([name, value]) => (
              <Swatch key={name} name={name} value={value} />
            ))}
        </Row>
      ))}
      <Row label="Lamps (henchman status lights)">
        {(Object.keys(lampColors) as (keyof typeof lampColors)[]).map((lamp) => (
          <span key={lamp} className="rg-chip">
            <span className="rg-lamp" style={lampStyle(lamp)} aria-hidden="true" />
            {lamp}
          </span>
        ))}
      </Row>
      <Row label="Gradients">
        {Object.entries(gradients).map(([name, value]) => (
          <div key={name} style={{ display: "grid", justifyItems: "center", gap: 4, fontSize: 11 }}>
            <span style={{ width: 96, height: 32, borderRadius: 5, background: value }} />
            <code>{name}</code>
          </div>
        ))}
      </Row>
      <Row label="Type">
        <div style={{ display: "grid", gap: 4 }}>
          <span className="rg-modal__title" style={{ margin: 0 }}>
            Saira Stencil One — nameplates
          </span>
          <span style={{ fontSize: 16, fontWeight: 400 }}>Barlow Regular 16 — body</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Barlow Semibold 15 — labels</span>
          <span style={{ fontFamily: "var(--rg-font-mono)", fontSize: 18 }}>
            Share Tech Mono 18 — 04:15 readouts
          </span>
        </div>
      </Row>
      <Row label="CSS variables">
        <details>
          <summary>{Object.keys(themeTokens).length} shared custom properties (--rg-*)</summary>
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
