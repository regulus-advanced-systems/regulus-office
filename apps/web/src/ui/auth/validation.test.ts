import { describe, expect, test } from "bun:test";
import { expiresIn, formatExpiry, roleLabel } from "./format.ts";
import { emailError, hasErrors, validateRegister, validateSignIn } from "./validation.ts";

const good = { name: "Ante", email: "ante@example.com", password: "12345678", confirm: "12345678" };

describe("auth form validation", () => {
  test("sign-in needs an email-shaped email and any password", () => {
    expect(validateSignIn({ email: "", password: "" })).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(validateSignIn({ email: "nope", password: "x" }).email).toBe(
      "Enter a valid email address.",
    );
    expect(hasErrors(validateSignIn({ email: " a@b.co ", password: "x" }))).toBe(false);
  });

  test("registration mirrors the server's rules", () => {
    expect(validateRegister(good)).toEqual({});
    expect(validateRegister({ ...good, name: "   " }).name).toBeString();
    expect(validateRegister({ ...good, name: "x".repeat(81) }).name).toContain("80");
    expect(
      validateRegister({ ...good, password: "1234567", confirm: "1234567" }).password,
    ).toContain("8");
    expect(
      validateRegister({ ...good, password: "x".repeat(129), confirm: "x".repeat(129) }).password,
    ).toContain("128");
    expect(validateRegister({ ...good, confirm: "different" }).confirm).toBe(
      "The passwords do not match.",
    );
  });

  test("emails", () => {
    expect(emailError("a@b.co")).toBeUndefined();
    expect(emailError("a b@c.co")).toBeString();
    expect(emailError("a@b")).toBeString();
    expect(emailError(`${"x".repeat(250)}@b.co`)).toBeString();
  });
});

describe("format helpers", () => {
  test("roles and expiry", () => {
    expect(roleLabel("admin")).toBe("an admin");
    expect(roleLabel("member")).toBe("a member");
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(expiresIn("2026-10-05T12:00:00Z", now)).toBe("in 7 days");
    expect(expiresIn("2026-09-28T15:00:00Z", now)).toBe("in 3 hours");
    expect(expiresIn("2026-09-28T12:05:00Z", now)).toBe("in 5 minutes");
    expect(expiresIn("2026-09-28T11:00:00Z", now)).toBe("expired");
    expect(formatExpiry("2026-10-05T12:00:00Z", "en-GB")).toContain("2026");
    expect(formatExpiry("garbage")).toBe("an unknown date");
  });
});
