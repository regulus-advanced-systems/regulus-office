/** DOM helpers for the board panel tests (happy-dom via ../a11y/dom.ts). Only imported by tests. */
import type { ReactNode } from "react";
import { act } from "react";
import { mount } from "../a11y/dom.ts";

export const renderPlain = (node: ReactNode) => mount(node);

export function button(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
}

export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

export const text = () => document.body.textContent ?? "";
