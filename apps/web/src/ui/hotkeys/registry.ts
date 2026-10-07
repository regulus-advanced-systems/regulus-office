/**
 * Keyboard shortcut registry (SPEC §9.2: F operation quick menu, V view toggle,
 * E interact, Z / C turn the camera; T / Enter focus the lobby chat; / search, #41;
 * hold G for the emote wheel, #49).
 * Since #190 `E` only interacts; the camera turns on Z and C, which double as
 * nothing else (SPEC §9.2 says Q/E, but E is interact). The registry is pure: it maps a key press to a binding id and
 * `dispatchHotkey` publishes a `regulus:hotkey` CustomEvent on `window`. The
 * elevator (#15) and camera/interaction work (#17) consume those events; the
 * HUD itself only handles the help overlay.
 */

export interface HotkeyBinding {
  /** Stable id consumers switch on, e.g. "quickTravel". */
  id: string;
  /** `KeyboardEvent.key` value, matched case-insensitively for letters. */
  key: string;
  /** Shown in the help overlay. */
  description: string;
  /** Grouping for the help overlay. */
  group: string;
  /**
   * Only fire when no control has keyboard focus (focus on the page body or
   * the canvas), so e.g. Enter still activates a focused button.
   */
  idleOnly?: boolean;
}

export const HOTKEY_EVENT = "regulus:hotkey";

export interface HotkeyEventDetail {
  id: string;
  key: string;
  /**
   * Set by a listener that acted on the press (an `interact` that found
   * something in reach), so a fallback listener can tell.
   */
  handled?: boolean;
}

export const DEFAULT_HOTKEYS: readonly HotkeyBinding[] = [
  {
    id: "quickTravel",
    key: "f",
    description: "Quick travel to a room you may enter, on any level",
    group: "Navigation",
  },
  {
    id: "turnLeft",
    key: "z",
    description: "Turn the camera left (or right-drag)",
    group: "Camera",
  },
  { id: "turnRight", key: "c", description: "Turn the camera right", group: "Camera" },
  {
    id: "toggleView",
    key: "v",
    description: "Toggle third-person / first-person",
    group: "Camera",
  },
  {
    id: "interact",
    key: "e",
    description:
      "Interact with what is in reach: desk, laptop, board, clipboard, gong, door button, the lift; sit down or stand up",
    group: "World",
  },
  {
    id: "emoteWheel",
    key: "g",
    description:
      "Hold for the emote wheel; point or use the arrows, let go to emote (tap: keep it open)",
    group: "Social",
  },
  { id: "focusChat", key: "t", description: "Focus the chat input", group: "Chat" },
  {
    id: "focusChatEnter",
    key: "Enter",
    description: "Focus the chat input (when nothing else is focused)",
    group: "Chat",
    idleOnly: true,
  },
  { id: "search", key: "/", description: "Search chat and henchmen's terminals", group: "Search" },
  { id: "help", key: "?", description: "Show keyboard shortcuts", group: "Help" },
];

/**
 * Shown in the help overlay but not dispatched: held keys and mouse
 * gestures the scene handles itself (running, #223).
 */
export const MOVEMENT_HELP: readonly HotkeyBinding[] = [
  {
    id: "run",
    key: "Shift",
    description: "Hold while walking (WASD or a clicked path) to run",
    group: "Movement",
  },
  {
    id: "runThere",
    key: "Double-click",
    description: "Run to that spot",
    group: "Movement",
  },
];

/**
 * Shown after the registered hotkeys, in their Social group: keys the emote
 * wheel and the whereabouts panel handle themselves (#49).
 */
export const SOCIAL_HELP: readonly HotkeyBinding[] = [
  {
    id: "emotePick",
    key: "1-6",
    description: "With the emote wheel open: wave, thumbs up, clap, dance, point, facepalm",
    group: "Social",
  },
  {
    id: "walkToTeammate",
    key: "Click a name",
    description: "In Who's where: walk to that teammate (stops at a door you may not open)",
    group: "Social",
  },
];

/** Binding ids that move keyboard focus to the chat input (ui/chat). */
export const FOCUS_CHAT_HOTKEYS: ReadonlySet<string> = new Set(["focusChat", "focusChatEnter"]);

export interface HotkeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is a text input, textarea, select or contenteditable. */
  editable?: boolean;
  /** True while a modal/overlay owns the keyboard. */
  overlayOpen?: boolean;
  /** True when a control (button, link, ...) other than the body or canvas has focus. */
  focused?: boolean;
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
      const binding = bindings.get(normalizeKey(input.key)) ?? null;
      if (binding?.idleOnly && input.focused) return null;
      return binding;
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

/** Whether a control holds keyboard focus, i.e. the target is not the page body or the canvas. */
export function isFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag !== "BODY" && tag !== "HTML" && tag !== "CANVAS";
}

export function dispatchHotkey(binding: HotkeyBinding, target: EventTarget = window): void {
  const detail: HotkeyEventDetail = { id: binding.id, key: binding.key };
  target.dispatchEvent(new CustomEvent<HotkeyEventDetail>(HOTKEY_EVENT, { detail }));
}

/** Shared registry with the SPEC §9.2 defaults; feature work registers more. */
export const hotkeys: HotkeyRegistry = createHotkeyRegistry(DEFAULT_HOTKEYS);
