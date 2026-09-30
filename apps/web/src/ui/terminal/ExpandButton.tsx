/** The expand / shrink toggle of the terminal dialogs (#156). */
import { Button } from "../components/Button.tsx";

export function ExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="rg-term__expand"
      aria-pressed={expanded}
      title={expanded ? "Back to the normal size" : "Make the terminal bigger"}
      data-testid="terminal-expand"
      onClick={onToggle}
    >
      <span aria-hidden="true">{expanded ? "⤡" : "⤢"}</span> {expanded ? "Shrink" : "Expand"}
    </Button>
  );
}
