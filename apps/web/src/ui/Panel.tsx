/**
 * White rounded panel with a 1 px grey border (SPEC §12). `heading` renders a
 * title; `muted` greys the panel to ~30% the way GDT shows "No Project".
 * Pass `as="section"` with `aria-label` for landmark panels.
 */
import type { CSSProperties, ReactNode } from "react";

export interface PanelProps {
  children: ReactNode;
  title?: ReactNode;
  as?: "div" | "section" | "nav" | "header" | "aside";
  flush?: boolean;
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Panel({
  children,
  title,
  as: Tag = "div",
  flush,
  muted,
  className,
  ...rest
}: PanelProps) {
  const cls = [
    "rg-panel",
    flush ? "rg-panel--flush" : "",
    muted ? "rg-panel--muted" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} {...rest}>
      {title && <h2 className="rg-panel__title">{title}</h2>}
      {children}
    </Tag>
  );
}
