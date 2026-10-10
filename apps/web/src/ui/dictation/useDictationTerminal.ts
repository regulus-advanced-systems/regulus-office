/** A terminal on screen offers itself as a dictation target while it is mounted (#260). */
import { useEffect } from "react";
import type { TerminalHost } from "../terminal/host.ts";
import { registerDictationTerminal } from "./targets.ts";

export function useDictationTerminal(
  element: HTMLElement | null,
  host: TerminalHost | null,
  readOnly: boolean,
): void {
  useEffect(() => {
    if (!element || !host) return;
    return registerDictationTerminal(element, host, () => readOnly);
  }, [element, host, readOnly]);
}
