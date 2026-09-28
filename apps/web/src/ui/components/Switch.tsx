/** Accessible toggle: a button with role="switch", operable by Space/Enter. */
import type { ReactNode } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, hint, disabled, id }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      className="rg-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="rg-switch__track">
        <span className="rg-switch__knob" />
      </span>
      <span>
        <span className="rg-field__label">{label}</span>
        {hint && <div className="rg-field__hint">{hint}</div>}
      </span>
    </button>
  );
}
