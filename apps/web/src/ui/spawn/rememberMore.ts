/**
 * Whether the spawn dialog's "More options" section is open, remembered per
 * user in this browser (#142). Storage may be missing or blocked; then the
 * section simply starts collapsed.
 */
const KEY_PREFIX = "regulus.spawn.moreOptions.";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadMoreOptionsOpen(userId: string | null): boolean {
  try {
    return storage()?.getItem(KEY_PREFIX + (userId ?? "anon")) === "1";
  } catch {
    return false;
  }
}

export function saveMoreOptionsOpen(userId: string | null, open: boolean): void {
  try {
    const key = KEY_PREFIX + (userId ?? "anon");
    if (open) storage()?.setItem(key, "1");
    else storage()?.removeItem(key);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}
