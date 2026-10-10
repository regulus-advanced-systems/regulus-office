/**
 * One watched host as the setup shows it (#253): where it is, whether its own
 * key is pinned yet, a key it now shows instead, and its apps with their
 * rooms. An app that is kept but not watched says so.
 */
import type { WatchdogHostView } from "@regulus/protocol";
import { Button } from "../components/Button.tsx";

const PINNED_BY = {
  given: "given by an admin",
  learned: "stored on first contact",
  accepted: "accepted by an admin",
  none: "none",
} as const;

export interface HostCardProps {
  host: WatchdogHostView;
  busy: boolean;
  roomName: (app: { operationId: string | null; operationHidden: boolean }) => string;
  onChange: () => void;
  onRemove: () => void;
  onAcceptKey: () => void;
}

export function HostCard({ host, busy, roomName, onChange, onRemove, onAcceptKey }: HostCardProps) {
  return (
    <div className="rg-watchdog-host">
      <div className="rg-settings__row">
        <span className="rg-settings__grow">
          <strong>{host.label}</strong>{" "}
          <span className="rg-muted">
            {host.username}@{host.host}:{host.port} · key stored ·{" "}
            {host.pinned.length > 0
              ? `host key pinned (${PINNED_BY[host.pinnedBy]})`
              : "host key not yet verified: the first one it shows will be trusted"}
          </span>
        </span>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Change ${host.label}`}
          onClick={onChange}
        >
          Change
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          aria-label={`Remove ${host.label}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {host.pinned.map((print) => (
        <div key={print} className="rg-field__hint">
          <code>{print}</code>
        </div>
      ))}
      {host.offeredAt !== undefined && (
        <div className="rg-watchdog__warning" role="alert">
          <div>
            {host.label} now shows another key than the pinned one. Its checks fail until someone
            accepts the new key. Accept it only if you know the host was reinstalled or its key was
            changed on purpose.
          </div>
          {host.offered.map((print) => (
            <div key={print}>
              <code>{print}</code>
            </div>
          ))}
          {host.offered.length === 0 ? (
            <div>
              The office could not read which key it shows, so there is nothing to accept yet. The
              pinned key stays.
            </div>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              aria-label={`Accept the new key of ${host.label}`}
              onClick={onAcceptKey}
            >
              Accept new key
            </Button>
          )}
        </div>
      )}
      <div className="rg-field__hint">
        {host.apps.length === 0
          ? "No apps are watched on it."
          : host.apps
              .map((a) => `${a.name} (${roomName(a)}${a.watched ? "" : ", not watched"})`)
              .join(", ")}
      </div>
    </div>
  );
}
