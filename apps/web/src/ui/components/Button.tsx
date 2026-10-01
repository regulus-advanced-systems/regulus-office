/**
 * Push buttons of the lair console (SPEC §12, #189; controls.css): henchman-yellow
 * primary, alarm-red destructive, painted-steel secondary and a flat ghost.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type ButtonVariant = "primary" | "destructive" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  /** React 19 passes `ref` as a prop; it reaches the <button>. */
  ref?: Ref<HTMLButtonElement>;
}

export function buttonClassName({
  variant = "secondary",
  size = "md",
  block = false,
  className,
}: Pick<ButtonProps, "variant" | "size" | "block" | "className">): string {
  return [
    "rg-btn",
    `rg-btn--${variant}`,
    size !== "md" ? `rg-btn--${size}` : "",
    block ? "rg-btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant,
  size,
  block,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClassName({ variant, size, block, className })} {...rest}>
      {icon}
      {children}
    </button>
  );
}
