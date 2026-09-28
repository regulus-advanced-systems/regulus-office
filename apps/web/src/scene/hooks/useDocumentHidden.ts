/** True while the tab is hidden, so the render loop can pause (SPEC §11). */
import { useEffect, useState } from "react";

export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(isDocumentHidden);
  useEffect(() => {
    const onChange = () => setHidden(isDocumentHidden());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}
