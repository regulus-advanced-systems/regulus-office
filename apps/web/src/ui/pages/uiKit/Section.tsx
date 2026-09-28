/** Layout helpers for the /ui-kit gallery. */
import type { ReactNode } from "react";

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} style={{ display: "grid", gap: 14 }}>
      <h2
        id={`${id}-title`}
        style={{
          margin: "24px 0 0",
          fontSize: 24,
          fontWeight: 300,
          borderBottom: "1px solid var(--rg-color-navy)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "center" }}
    >
      <div className="rg-muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}
