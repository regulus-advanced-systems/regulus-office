/**
 * Client-side form checks for the auth pages. They mirror the server's rules
 * (Better Auth: password 8..128; /api/join: name 1..80, email <= 254) so the
 * user hears about mistakes before a round trip; the server stays the
 * authority.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface SignInFields {
  email: string;
  password: string;
}

export interface RegisterFields extends SignInFields {
  name: string;
  confirm: string;
}

/** Deliberately loose: one @, something on each side, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(email: string): string | undefined {
  const v = email.trim();
  if (v.length === 0) return "Enter your email address.";
  if (v.length > EMAIL_MAX || !EMAIL_RE.test(v)) return "Enter a valid email address.";
  return undefined;
}

export function validateSignIn(f: SignInFields): FieldErrors<keyof SignInFields> {
  const errors: FieldErrors<keyof SignInFields> = {};
  const email = emailError(f.email);
  if (email) errors.email = email;
  if (f.password.length === 0) errors.password = "Enter your password.";
  return errors;
}

export function validateRegister(f: RegisterFields): FieldErrors<keyof RegisterFields> {
  const errors: FieldErrors<keyof RegisterFields> = {};
  const name = f.name.trim();
  if (name.length === 0) errors.name = "Enter the name others will see.";
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;
  const email = emailError(f.email);
  if (email) errors.email = email;
  if (f.password.length < PASSWORD_MIN)
    errors.password = `Use at least ${PASSWORD_MIN} characters.`;
  else if (f.password.length > PASSWORD_MAX)
    errors.password = `Use at most ${PASSWORD_MAX} characters.`;
  if (f.confirm !== f.password) errors.confirm = "The passwords do not match.";
  return errors;
}

export const hasErrors = (errors: Record<string, string | undefined>): boolean =>
  Object.values(errors).some((e) => e !== undefined);
