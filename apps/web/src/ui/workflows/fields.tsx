/** Small form fields for the workflow editor (#155). */
import { type ReactNode, useId, useState } from "react";
import { patternsToText, textToPatterns } from "./workflowForm.ts";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="rg-field">
      <label className="rg-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="rg-field__hint">{hint}</div>}
    </div>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <input
        id={id}
        className="rg-input"
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      />
    </Field>
  );
}

export function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <input
        id={id}
        className="rg-input rg-workflows__number"
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => {
          const n = Math.round(Number(e.currentTarget.value));
          if (Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, n)));
        }}
      />
    </Field>
  );
}

/** One pattern per line; keeps what is typed, reports the parsed list. */
export function PatternField(props: {
  label: string;
  value: readonly string[];
  onChange: (v: string[]) => void;
  hint?: ReactNode;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => patternsToText(props.value));
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <textarea
        id={id}
        className="rg-input rg-workflows__patterns"
        rows={2}
        value={text}
        placeholder={props.placeholder}
        onChange={(e) => {
          setText(e.currentTarget.value);
          props.onChange(textToPatterns(e.currentTarget.value));
        }}
      />
    </Field>
  );
}

export function Checks<T extends string>(props: {
  legend: string;
  options: readonly T[];
  value: readonly T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset className="rg-workflows__checks">
      <legend className="rg-field__label">{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o} className="rg-workflows__check">
          <input
            type="checkbox"
            checked={props.value.includes(o)}
            onChange={(e) =>
              props.onChange(
                e.currentTarget.checked ? [...props.value, o] : props.value.filter((v) => v !== o),
              )
            }
          />{" "}
          {o.replaceAll("_", " ")}
        </label>
      ))}
    </fieldset>
  );
}

export function Select<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <select
        id={id}
        className="rg-input"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value as T)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
