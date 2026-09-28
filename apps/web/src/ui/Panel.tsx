/** White rounded panel with a 1 px grey border (SPEC §12); `modal` gives the golden variant. */
import type { CSSProperties, ReactNode } from "react";
import { colors, radii } from "./theme.ts";

export function Panel({
  children,
  modal = false,
  style,
}: {
  children: ReactNode;
  modal?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: modal ? colors.modalSurface : colors.panelSurface,
        border: `${modal ? 2 : 1}px solid ${modal ? colors.gold : colors.panelBorder}`,
        borderRadius: radii.panel,
        boxShadow: modal ? `0 0 24px ${colors.cream}` : "0 2px 8px rgba(0,0,0,0.08)",
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
