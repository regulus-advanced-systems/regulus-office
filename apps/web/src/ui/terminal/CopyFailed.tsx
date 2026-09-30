/**
 * Shown over the terminal when the browser refused every way to write the
 * clipboard (#164): says so plainly and shows the text selected in a box, so
 * the key the browser always honours (Ctrl+C, Cmd+C on a Mac) copies it.
 * The HUD's toasts sit under the dialog's backdrop, so this is drawn here.
 */
import { useEffect, useRef } from "react";
import { CloseButton } from "../components/CloseButton.tsx";

export function CopyFailed({
  text,
  mac,
  onClose,
}: {
  text: string;
  mac: boolean;
  onClose: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const box = area.current;
    if (!box) return;
    box.focus({ preventScroll: true });
    box.select();
    // Native, so it runs before the dialog's own Escape handler: Escape closes only this box.
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") onClose();
    };
    box.addEventListener("keydown", onKey);
    return () => box.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="rg-term__copy-failed" role="alert" data-testid="terminal-copy-failed">
      <div className="rg-term__copy-failed-head">
        <strong>Couldn't copy: the browser blocked the clipboard.</strong>
        <CloseButton small label="Dismiss" onClick={onClose} />
      </div>
      <p>The text is selected below. Press {mac ? "Cmd+C" : "Ctrl+C"} to copy it.</p>
      <textarea ref={area} readOnly value={text} aria-label="Text to copy" />
    </div>
  );
}
