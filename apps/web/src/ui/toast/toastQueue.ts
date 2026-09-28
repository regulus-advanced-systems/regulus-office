/**
 * Toast queue as a pure reducer so it can be tested without React or timers.
 * Toasts are shown oldest-first, at most `maxVisible` at a time; each visible
 * toast expires `durationMs` after it became visible (0 = sticky until
 * dismissed). The store calls `tick` with the current time to advance.
 */

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastInput {
  kind?: ToastKind;
  title?: string;
  message: string;
  /** Milliseconds shown before auto-dismiss; 0 keeps it until dismissed. */
  durationMs?: number;
}

export interface Toast extends Required<Omit<ToastInput, "title">> {
  id: string;
  title: string | undefined;
  createdAt: number;
  /** Set once the toast entered the visible window. */
  shownAt: number | null;
}

export interface ToastQueueState {
  toasts: Toast[];
  maxVisible: number;
  nextId: number;
}

export const DEFAULT_TOAST_DURATION_MS: Readonly<Record<ToastKind, number>> = {
  info: 5000,
  success: 4000,
  warning: 7000,
  error: 0,
};

export function createToastQueue(maxVisible = 3): ToastQueueState {
  return { toasts: [], maxVisible, nextId: 1 };
}

export type ToastAction =
  | { type: "push"; toast: ToastInput }
  | { type: "dismiss"; id: string }
  | { type: "clear" }
  | { type: "tick" };

/** Mark the head of the queue as shown and drop expired ones. */
function settle(state: ToastQueueState, now: number): ToastQueueState {
  const live = state.toasts.filter(
    (t) => t.shownAt === null || t.durationMs === 0 || t.shownAt + t.durationMs > now,
  );
  let visible = 0;
  const toasts = live.map((t) => {
    if (visible >= state.maxVisible) return t;
    visible += 1;
    return t.shownAt === null ? { ...t, shownAt: now } : t;
  });
  return { ...state, toasts };
}

export function reduceToasts(
  state: ToastQueueState,
  action: ToastAction,
  now: number,
): ToastQueueState {
  switch (action.type) {
    case "push": {
      const kind = action.toast.kind ?? "info";
      const toast: Toast = {
        id: `toast-${state.nextId}`,
        kind,
        title: action.toast.title,
        message: action.toast.message,
        durationMs: action.toast.durationMs ?? DEFAULT_TOAST_DURATION_MS[kind],
        createdAt: now,
        shownAt: null,
      };
      return settle({ ...state, nextId: state.nextId + 1, toasts: [...state.toasts, toast] }, now);
    }
    case "dismiss":
      return settle({ ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }, now);
    case "clear":
      return { ...state, toasts: [] };
    case "tick":
      return settle(state, now);
  }
}

export function visibleToasts(state: ToastQueueState): Toast[] {
  return state.toasts.filter((t) => t.shownAt !== null);
}

/** Time until the next visible toast expires, or null when nothing is timed. */
export function nextExpiryDelay(state: ToastQueueState, now: number): number | null {
  let soonest: number | null = null;
  for (const t of state.toasts) {
    if (t.shownAt === null || t.durationMs === 0) continue;
    const at = t.shownAt + t.durationMs;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest === null ? null : Math.max(0, soonest - now);
}
