/**
 * Email + password forms. Inputs are uncontrolled: values are read from the
 * form once on submit and sent once, so passwords never sit in React state
 * and nothing is persisted (SPEC §8).
 */
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "../components/Button.tsx";
import { FormAlert, TextField } from "./AuthCard.tsx";
import { type ApiResult, describeAuthError } from "./api.ts";
import { hasErrors, validateRegister, validateSignIn } from "./validation.ts";

type Errors = Record<string, string | undefined>;

/** Read named string fields out of a submitted form. */
function readFields<K extends string>(
  form: HTMLFormElement,
  keys: readonly K[],
): Record<K, string> {
  const data = new FormData(form);
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = data.get(k);
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

/**
 * Shared submit flow: validate, call, and on success hand over to `onSuccess`
 * (which refreshes the session and navigates).
 */
function useSubmit<F>(
  validate: (f: F) => Errors,
  submit: (f: F) => Promise<ApiResult<unknown>>,
  onSuccess: () => Promise<boolean>,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const run = async (fields: F) => {
    const errors = validate(fields);
    setFieldErrors(errors);
    if (hasErrors(errors)) return;
    setBusy(true);
    setError(null);
    const result = await submit(fields);
    if (!result.ok) {
      setBusy(false);
      setError(describeAuthError(result));
      return;
    }
    if (!(await onSuccess())) {
      setBusy(false);
      setError("Signed in, but the session could not be confirmed. Reload the page.");
    }
  };
  return { busy, error, fieldErrors, run };
}

export interface SignInFormProps {
  submit: (f: { email: string; password: string }) => Promise<ApiResult<unknown>>;
  onSuccess: () => Promise<boolean>;
}

export function SignInForm({ submit, onSuccess }: SignInFormProps) {
  const { busy, error, fieldErrors, run } = useSubmit(validateSignIn, submit, onSuccess);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = readFields(e.currentTarget, ["email", "password"] as const);
    void run({ email: f.email.trim(), password: f.password });
  };
  return (
    <form onSubmit={onSubmit} noValidate aria-label="Sign in">
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        error={fieldErrors.email}
        autoFocus
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        error={fieldErrors.password}
      />
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" variant="primary" block disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export interface RegisterFormProps {
  submit: (f: { name: string; email: string; password: string }) => Promise<ApiResult<unknown>>;
  onSuccess: () => Promise<boolean>;
  submitLabel: string;
  /** Extra content above the button. */
  children?: ReactNode;
}

const REGISTER_KEYS = ["name", "email", "password", "confirm"] as const;

export function RegisterForm({ submit, onSuccess, submitLabel, children }: RegisterFormProps) {
  const { busy, error, fieldErrors, run } = useSubmit(
    validateRegister,
    (f: Record<(typeof REGISTER_KEYS)[number], string>) =>
      submit({ name: f.name.trim(), email: f.email.trim(), password: f.password }),
    onSuccess,
  );
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void run(readFields(e.currentTarget, REGISTER_KEYS));
  };
  return (
    <form onSubmit={onSubmit} noValidate aria-label={submitLabel}>
      <TextField
        label="Display name"
        name="name"
        autoComplete="nickname"
        maxLength={80}
        error={fieldErrors.name}
        autoFocus
      />
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        error={fieldErrors.email}
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={fieldErrors.password}
      />
      <TextField
        label="Confirm password"
        type="password"
        name="confirm"
        autoComplete="new-password"
        error={fieldErrors.confirm}
      />
      {children}
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" variant="primary" block disabled={busy}>
        {busy ? "Creating account…" : submitLabel}
      </Button>
    </form>
  );
}
