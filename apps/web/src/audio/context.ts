/**
 * The office's one AudioContext (#47): footsteps, dings, the gong, the
 * blast door and the beach, the jukebox and (#48) proximity voice all play
 * through it, so the browser mixes one graph instead of one per sound.
 *
 * Browsers start a context suspended until the page has had a user gesture
 * (autoplay policy). `unlockAudioOnGesture` resumes it on the first click,
 * tap or key press (the "Enter the lair" click, or any later one) and tells
 * `onAudioUnlocked` listeners, so music never starts before the human did
 * something. Every helper returns null without Web Audio (tests, old
 * browsers); audio is decoration and never throws.
 */

let context: AudioContext | null = null;
let unlocked = false;
const listeners = new Set<() => void>();

/** The shared context, created on first use; null without Web Audio. */
export function sharedAudioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = globalThis.AudioContext ?? null;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Has the page had the gesture that lets audio start? */
export function audioUnlocked(): boolean {
  return unlocked;
}

/** Call `listener` once audio is unlocked (at once when it already is); returns the unsubscribe. */
export function onAudioUnlocked(listener: () => void): () => void {
  if (unlocked) {
    listener();
    return () => undefined;
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mark audio unlocked and resume the context (from inside a gesture handler). */
export function unlockAudio(): void {
  const ctx = sharedAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  if (unlocked) return;
  unlocked = true;
  for (const listener of [...listeners]) listener();
  listeners.clear();
}

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/** Unlock on the page's first gesture; idempotent. Returns a remover (tests). */
export function unlockAudioOnGesture(target: EventTarget = globalThis.window): () => void {
  if (!target) return () => undefined;
  const handler = () => {
    unlockAudio();
    for (const type of GESTURES) target.removeEventListener(type, handler, true);
  };
  for (const type of GESTURES) target.addEventListener(type, handler, true);
  return () => {
    for (const type of GESTURES) target.removeEventListener(type, handler, true);
  };
}

/** Tests only: forget the context and the unlock. */
export function resetSharedAudioForTests(): void {
  context = null;
  unlocked = false;
  listeners.clear();
}
