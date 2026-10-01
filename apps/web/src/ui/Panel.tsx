/**
 * Riveted console plate in a brass frame (SPEC §12 "UI", #189). `title`
 * renders a stencil heading; `muted` greys the panel to ~30%.
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
