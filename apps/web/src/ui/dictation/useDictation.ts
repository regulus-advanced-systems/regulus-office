/**
 * Wires dictation (#260) to the page: one controller on the browser's own
 * speech engines, the Ctrl+Space hold on `window` (capture phase, before the
 * terminal sees the key), the entry in the shortcuts help, and what has focus
 * (for the mic button).
 */
import { useEffect, useState } from "react";
import { useMediaStore } from "../../media/store.ts";
import { useBuildingStore } from "../../state/building.ts";
import { hotkeys } from "../hotkeys/registry.ts";
import { DictationController } from "./controller.ts";
import { useDictationStore } from "./dictationStore.ts";
import { createHoldKey, DICTATION_HOTKEY } from "./holdKey.ts";
import { onDictationTerminalsChanged, resolveTarget, type TargetLookup } from "./targets.ts";
import { createBrowserEngines } from "./webSpeech.ts";

/**
 * An open voice-chat mic would carry the dictated prompt to everyone nearby:
 * mute it for the hold and put it back after. A muted mic, or push-to-talk
 * with M up, is already silent and is left alone.
 */
export function pauseVoiceMic(): (() => void) | null {
  const media = useMediaStore.getState();
  const self = useBuildingStore.getState().sessionId ?? "";
  if (!media.controller || !media.micOn || media.voices[self]?.mic !== "on") return null;
  void media.controller.setMic(false);
  return () => void useMediaStore.getState().controller?.setMic(true);
}

let shared: DictationController | null = null;

/** The page's dictation controller (made on first use). */
export function dictation(): DictationController {
  shared ??= new DictationController({
    engines: createBrowserEngines(),
    browserLang: () => globalThis.navigator?.language ?? "",
    pauseVoice: pauseVoiceMic,
  });
  return shared;
}

export const focusedTarget = (): TargetLookup => resolveTarget(document.activeElement);

/** The hold key, the help entry and stop-on-leave. Mounted once, by the HUD. */
export function useDictationKey(controller: DictationController = dictation()): void {
  useEffect(() => {
    let unregister: (() => void) | undefined;
    try {
      unregister = hotkeys.register(DICTATION_HOTKEY);
    } catch {
      // Already registered (a second mount in tests).
    }
    const hold = createHoldKey(controller, focusedTarget);
    const hidden = () => {
      if (document.visibilityState === "hidden") hold.drop();
    };
    window.addEventListener("keydown", hold.keydown, true);
    window.addEventListener("keyup", hold.keyup, true);
    window.addEventListener("blur", hold.drop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unregister?.();
      window.removeEventListener("keydown", hold.keydown, true);
      window.removeEventListener("keyup", hold.keyup, true);
      window.removeEventListener("blur", hold.drop);
      document.removeEventListener("visibilitychange", hidden);
      controller.cancel();
    };
  }, [controller]);
}

/** The focused element when it can be dictated into (and dictation is on), else null. */
export function useFocusedTargetElement(): HTMLElement | null {
  const enabled = useDictationStore((s) => s.prefs.enabled);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) {
      setElement(null);
      return;
    }
    const read = () => {
      const lookup = focusedTarget();
      setElement(lookup && "target" in lookup ? lookup.target.element : null);
    };
    // After the focus has settled on its new element (or on none).
    const later = () => queueMicrotask(read);
    read();
    document.addEventListener("focusin", later);
    document.addEventListener("focusout", later);
    const offTerminals = onDictationTerminalsChanged(later);
    return () => {
      offTerminals();
      document.removeEventListener("focusin", later);
      document.removeEventListener("focusout", later);
    };
  }, [enabled]);
  return element;
}
