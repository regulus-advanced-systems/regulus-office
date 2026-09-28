/**
 * Keyboard shortcut registry (SPEC §9.2: F floor quick menu, V view toggle,
 * E interact). The registry is pure: it maps a key press to a binding id and
 * `dispatchHotkey` publishes a `regulus:hotkey` CustomEvent on `window`. The
 * elevator (#15) and camera/interaction work (#17) consume those events; the
 * HUD itself only handles the help overlay.
 */

export interface HotkeyBinding {
  /** Stable id consumers switch on, e.g. "floorMenu". */
  id: string;
  /** `KeyboardEvent.key` value, matched case-insensitively for letters. */
  key: string;
  /** Shown in the help overlay. */
  description: string;
  /** Grouping for the help overlay. */
  group: string;
}

export const HOTKEY_EVENT = "regulus:hotkey";

export interface HotkeyEventDetail {
  id: string;
  key: string;
}

export const DEFAULT_HOTKEYS: readonly HotkeyBinding[] = [
  { id: "floorMenu", key: "f", description: "Floor quick menu (teleport)", group: "Navigation" },
  {
    id: "toggleView",
    key: "v",
    description: "Toggle third-person / first-person",
    group: "Camera",
  },
  { id: "interact", key: "e", description: "Interact with the nearest object", group: "World" },
  { id: "help", key: "?", description: "Show keyboard shortcuts", group: "Help" },
];

export interface HotkeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is a text input, textarea, select or contenteditable. */
  editable?: boolean;
  /** True while a modal/overlay owns the keyboard. */
  overlayOpen?: boolean;
}

export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export interface HotkeyRegistry {
  register: (binding: HotkeyBinding) => () => void;
  /** Bindings in registration order (for the help overlay). */
  list: () => HotkeyBinding[];
  /** The binding a key press activates, or null when it should be ignored. */
  resolve: (input: HotkeyInput) => HotkeyBinding | null;
}

export function createHotkeyRegistry(initial: readonly HotkeyBinding[] = []): HotkeyRegistry {
  const bindings = new Map<string, HotkeyBinding>();
  const register = (binding: HotkeyBinding) => {
    const key = normalizeKey(binding.key);
    if (bindings.has(key)) throw new Error(`hotkey "${binding.key}" already bound`);
    bindings.set(key, binding);
    return () => {
      if (bindings.get(key) === binding) bindings.delete(key);
    };
  };
  for (const b of initial) register(b);
  return {
    register,
    list: () => Array.from(bindings.values()),
    resolve: (input) => {
      if (input.ctrlKey || input.metaKey || input.altKey) return null;
      if (input.editable || input.overlayOpen) return null;
      return bindings.get(normalizeKey(input.key)) ?? null;
    },
  };
}

/** Whether keystrokes on this element are text entry and must not trigger hotkeys. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function dispatchHotkey(binding: HotkeyBinding, target: EventTarget = window): void {
  const detail: HotkeyEventDetail = { id: binding.id, key: binding.key };
  target.dispatchEvent(new CustomEvent<HotkeyEventDetail>(HOTKEY_EVENT, { detail }));
}

/** Shared registry with the SPEC §9.2 defaults; feature work registers more. */
export const hotkeys: HotkeyRegistry = createHotkeyRegistry(DEFAULT_HOTKEYS);
