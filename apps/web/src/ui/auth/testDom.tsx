/** DOM helpers for the auth page tests (happy-dom via ../a11y/dom.ts). Only imported by tests. */
import { act, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { mount } from "../a11y/dom.ts";
import { AuthProvider } from "./context.tsx";

/** The auth forms are uncontrolled, so setting the DOM value is what a user's typing does. */
export async function typeInto(label: string, value: string) {
  const input = inputByLabel(label);
  await act(async () => {
    input.value = value;
  });
}

export function inputByLabel(label: string): HTMLInputElement {
  const el = Array.from(document.querySelectorAll("label")).find(
    (l) => l.textContent?.trim() === label,
  );
  const id = el?.getAttribute("for");
  const input = id ? document.getElementById(id) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input labelled "${label}"`);
  return input;
}

export function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
}

export async function submit(formLabel: string) {
  const form = document.querySelector(`form[aria-label="${formLabel}"]`);
  if (!form) throw new Error(`no form "${formLabel}"`);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Let pending fetch promises and the renders they trigger finish. */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

export const text = () => document.body.textContent ?? "";

function Where() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

export const location = () => document.querySelector('[data-testid="location"]')?.textContent ?? "";

/** Mount `routes` at `path` with the auth API wired to `fetchFn`; the current path is readable via {@link location}. */
export async function renderAt(
  path: string,
  fetchFn: typeof fetch,
  routes: { path: string; element: ReactNode }[],
) {
  const router = createMemoryRouter(
    routes.map((r) => ({
      path: r.path,
      element: (
        <>
          {r.element}
          <Where />
        </>
      ),
    })),
    { initialEntries: [path] },
  );
  const m = await mount(
    <AuthProvider fetch={fetchFn}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  await settle();
  return m;
}
