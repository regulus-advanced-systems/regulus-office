/**
 * happy-dom bootstrap for component tests. Registers window/document
 * globals for the current test file and removes them afterwards so the
 * remaining bun:test files still see a plain Bun runtime.
 */
import { afterAll, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

export function useDom(): void {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });
}

export interface Mounted {
  container: HTMLElement;
  root: Root;
  rerender: (node: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
}

export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    root,
    rerender: (next) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export async function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

export async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}
