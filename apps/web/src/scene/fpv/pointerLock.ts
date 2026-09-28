/**
 * Pointer Lock API wrapper. `requestPointerLock` rejects (or throws in old
 * engines) when there is no user activation or during the cool-down after an
 * Escape exit; the rig then shows a "click to look around" hint and retries
 * on the next click, so the rejection is swallowed here.
 */
export function requestPointerLock(el: Element): void {
  if (typeof el.requestPointerLock !== "function") return;
  try {
    const result = el.requestPointerLock() as Promise<void> | undefined;
    result?.catch?.(() => {});
  } catch {
    // Unsupported or blocked: stay unlocked; the HUD hint explains.
  }
}

export function exitPointerLock(doc: Document = document): void {
  if (doc.pointerLockElement && typeof doc.exitPointerLock === "function") doc.exitPointerLock();
}
