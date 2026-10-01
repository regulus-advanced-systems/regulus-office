/**
 * Emergency stop (SPEC §14 D12, #138): office owners/admins watching someone
 * else's robot get one lever, behind a confirm. It kills the robot's session
 * and keeps its branch, worktree and desk; the server audits who stopped
 * whose robot and why. The robot's owner uses the ordinary Stop instead.
 */
import type { RobotState } from "@regulus/protocol";
import { useId, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { useAgentSender } from "./agentCommands.ts";
import { flightKey, useAgentStore } from "./agentStore.ts";

export function EmergencyStop({ robot }: { robot: RobotState }) {
  const agentId = robot.agentId;
  const send = useAgentSender();
  const [confirming, setConfirming] = useState(false);
  const reasonId = useId();
  const reasonBox = useRef<HTMLInputElement>(null);
  const busy = useAgentStore((s) => Boolean(s.inFlight[flightKey(agentId, "agent.emergencyStop")]));
  const owner = robot.ownerName || "its owner";

  if (!confirming) {
    return (
      <Button size="sm" variant="destructive" block onClick={() => setConfirming(true)}>
        Emergency stop
      </Button>
    );
  }

  const confirm = (event: React.FormEvent) => {
    event.preventDefault();
    const reason = reasonBox.current?.value.trim() ?? "";
    send("agent.emergencyStop", { agentId, ...(reason ? { reason } : {}) });
    setConfirming(false);
  };

  return (
    <form className="rg-agent-estop" aria-label="Confirm emergency stop" onSubmit={confirm}>
      <p className="rg-agent-estop__lead">
        Stop {owner}'s henchman? Its session is killed; the branch, worktree and desk stay, and only{" "}
        {owner} can resume it. The stop is recorded in the audit log.
      </p>
      <label className="rg-field__label" htmlFor={reasonId}>
        Reason (optional)
      </label>
      <input
        id={reasonId}
        ref={reasonBox}
        className="rg-input"
        maxLength={200}
        placeholder="Runaway cost, touching the wrong files…"
      />
      <div className="rg-agent-actions">
        <Button size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="destructive" disabled={busy}>
          Stop henchman
        </Button>
      </div>
    </form>
  );
}
