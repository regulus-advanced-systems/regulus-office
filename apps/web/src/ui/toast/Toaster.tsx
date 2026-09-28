/**
 * Toast host, bottom-right. Notifications follow research 03 §5 (golden
 * bordered card with an icon). Rendered with role="status" so screen readers
 * announce them; the slide-in animation is disabled under reduced motion.
 */
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { CloseButton } from "../components/CloseButton.tsx";
import { AlertIcon, CheckIcon, InfoIcon, WarningIcon } from "../components/icons.tsx";
import { type Toast, type ToastKind, visibleToasts } from "./toastQueue.ts";

const ICONS: Record<ToastKind, typeof InfoIcon> = {
  info: InfoIcon,
  success: CheckIcon,
  warning: WarningIcon,
  error: AlertIcon,
};

export function ToastCard({
  toast,
  onDismiss,
  reducedMotion,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  reducedMotion: boolean;
}) {
  const Icon = ICONS[toast.kind];
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={`rg-toast rg-toast--${toast.kind}`}
      style={reducedMotion ? { animation: "none" } : undefined}
      data-toast-id={toast.id}
    >
      <span className="rg-toast__icon">
        <Icon style={{ fontSize: 22 }} />
      </span>
      <div>
        {toast.title && <div className="rg-toast__title">{toast.title}</div>}
        <div className="rg-toast__text">{toast.message}</div>
      </div>
      <CloseButton small label="Dismiss notification" onClick={() => onDismiss(toast.id)} />
    </div>
  );
}

export function Toaster() {
  const queue = useUiStore((s) => s.toastQueue);
  const dismiss = useUiStore((s) => s.dismissToast);
  const reducedMotion = useUiStore(selectReducedMotion);
  const shown = visibleToasts(queue);
  if (shown.length === 0) return null;
  return (
    <div className="rg-toasts" aria-live="polite">
      {shown.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={dismiss} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}
