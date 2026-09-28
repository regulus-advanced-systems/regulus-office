/** Round white "X" with an orange rim (research 03 §5), used by modals and toasts. */
import type { ButtonHTMLAttributes } from "react";
import { XIcon } from "./icons.tsx";

export interface CloseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  small?: boolean;
  label?: string;
}

export function CloseButton({ small, label = "Close", className, ...rest }: CloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={["rg-close", small ? "rg-close--sm" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <XIcon style={{ fontSize: small ? 12 : 16 }} />
    </button>
  );
}
