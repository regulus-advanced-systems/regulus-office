/**
 * Permission prompt (#33, SPEC §7 `permission_request`): a GDT modal that
 * shows exactly what the robot wants to do (the tool and the full command or
 * file summary) with the options the agent offers: allow once, allow always,
 * reject. It pops up for the robot's controller when a request arrives and
 * from the raised hand in the panel. Only controllers ever receive the
 * requests (SPEC §8 rule 4), so nothing here is shown to watchers.
 */
import type { PendingPermission, PermissionDecision } from "@regulus/protocol";
import { useFloorStore } from "../../state/floor.ts";
import { Button, type ButtonVariant } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { useAgentSender } from "./agentCommands.ts";
import { flightKey, useAgentStore } from "./agentStore.ts";
import { DECISION_LABELS } from "./labels.ts";
import { useAgentOverlay } from "./useAgentOverlay.ts";

const VARIANT: Record<PermissionDecision, ButtonVariant> = {
  allow_once: "primary",
  allow_always: "secondary",
  reject: "destructive",
};
/** Reject last, so the safe default is not the first thing Enter hits. */
const ORDER: PermissionDecision[] = ["allow_once", "allow_always", "reject"];

const EMPTY: PendingPermission[] = [];

function expiresIn(request: PendingPermission, now: number): string | null {
  if (!request.expiresAt) return null;
  const seconds = Math.max(0, Math.round((request.expiresAt - now) / 1000));
  if (seconds >= 120) return `${Math.round(seconds / 60)} min`;
  return `${seconds} s`;
}

export function PermissionDialog({ now = Date.now }: { now?: () => number }) {
  const agentId = useAgentStore((s) => s.permissionAgentId);
  const requests = useAgentStore((s) => (agentId ? (s.permissions[agentId] ?? EMPTY) : EMPTY));
  const busy = useAgentStore((s) =>
    agentId ? Boolean(s.inFlight[flightKey(agentId, "agent.approve")]) : false,
  );
  const refusal = useAgentStore((s) => (agentId ? s.refusal[agentId] : undefined));
  const close = useAgentStore((s) => s.closePermissionPrompt);
  const robot = useFloorStore((s) => (agentId ? s.state?.robots[agentId] : undefined));
  const send = useAgentSender();
  const request = requests[0];
  const open = Boolean(agentId && request);
  useAgentOverlay(open, "agent-permission");
  if (!agentId || !request) return null;

  const who = robot?.taskTitle ? `“${robot.taskTitle}”` : "This robot";
  const expiry = expiresIn(request, now());
  const answer = (decision: PermissionDecision) =>
    send("agent.approve", { agentId, requestId: request.requestId, decision });

  return (
    <Modal
      open={open}
      onClose={close}
      title="Permission needed"
      width={560}
      dismissOnBackdrop={false}
      footer={ORDER.filter((d) => request.options.includes(d)).map((decision) => (
        <Button
          key={decision}
          variant={VARIANT[decision]}
          disabled={busy}
          onClick={() => answer(decision)}
        >
          {DECISION_LABELS[decision]}
        </Button>
      ))}
    >
      <p className="rg-agent-permission__lead">
        {who} wants to use <strong>{request.toolName}</strong>
        {requests.length > 1 ? ` (1 of ${requests.length} requests)` : ""}:
      </p>
      <pre className="rg-agent-permission__what" aria-label="What would run">
        {request.description}
      </pre>
      {request.options.includes("allow_always") && (
        <p className="rg-field__hint">
          “Allow always” allows this kind of action for the rest of the robot's session.
        </p>
      )}
      {expiry && (
        <p className="rg-field__hint">
          The office can answer for about {expiry} more; after that, answer in the robot's terminal.
        </p>
      )}
      {refusal?.type === "agent.approve" && (
        <div role="alert" className="rg-form-alert">
          {refusal.reason}
        </div>
      )}
    </Modal>
  );
}
