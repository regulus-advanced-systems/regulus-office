/**
 * GDT-style modal (SPEC §12, research 03 §5): centred, warm off-white
 * `#FFF9EF` with a thick golden `#F5C542` border and cream glow, large light
 * title over a thin navy rule, round X overlapping the top-right corner.
 * The scene behind dims with a cream overlay and slight blur. Focus is
 * trapped, Escape closes, and focus returns to the opener.
 */
import { type CSSProperties, type ReactNode, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../a11y/useFocusTrap.ts";
import { CloseButton } from "./CloseButton.tsx";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  width?: number;
  /** Render inline instead of portalling to <body> (ui-kit previews). */
  inline?: boolean;
  /** Clicking the backdrop closes the dialog (default true). */
  dismissOnBackdrop?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  inline = false,
  dismissOnBackdrop = true,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, { active: open && !inline, onEscape: onClose });
  if (!open) return null;

  const dialog = (
    <div
      className="rg-backdrop"
      style={inline ? { position: "relative", padding: 28, borderRadius: 12 } : undefined}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="rg-modal"
        style={{ "--rg-modal-width": `${width}px` } as CSSProperties}
      >
        <CloseButton className="rg-modal__close" onClick={onClose} />
        <h1 id={titleId} className="rg-modal__title">
          {title}
        </h1>
        <div className="rg-modal__body">{children}</div>
        {footer && <div className="rg-modal__footer">{footer}</div>}
      </div>
    </div>
  );
  return inline ? dialog : createPortal(dialog, document.body);
}
