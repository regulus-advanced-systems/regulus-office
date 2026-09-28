/**
 * Building blocks shared by the login, join and invite UIs: the golden
 * modal-style card for full-page auth screens, a labelled text field with an
 * accessible inline error, and an alert line for request failures.
 */
import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import "./auth.css";

export function AuthCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  const titleId = useId();
  return (
    <main className="centered rg-auth">
      <section className="rg-modal rg-auth__card" aria-labelledby={titleId}>
        <h1 id={titleId} className="rg-modal__title">
          {title}
        </h1>
        <div className="rg-modal__body">{children}</div>
      </section>
    </main>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextField({ label, error, hint, ...input }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : "", hint ? hintId : ""].filter(Boolean).join(" ");
  return (
    <div className="rg-field">
      <label className="rg-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="rg-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && (
        <div id={hintId} className="rg-field__hint">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="rg-field__error">
          {error}
        </div>
      )}
    </div>
  );
}

export function FormAlert({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "info";
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={kind === "error" ? "rg-form-alert" : "rg-form-alert rg-form-alert--info"}
    >
      {children}
    </div>
  );
}
