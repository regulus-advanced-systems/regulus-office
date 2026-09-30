/**
 * Robot panel (#33): opened from the robot or its desk (`openAgentPanel`,
 * called by the scene, #29). Everyone who can see the floor gets the
 * robot's status, task, model and owner and can watch its terminal; its
 * controllers (owner, office owner/admin: D12) also get the prompt box,
 * the raised-hand approval, interrupt / stop / resume, send home and the
 * one-click PR. The server checks every command again.
 */
import { mayControlRobot, type RobotState } from "@regulus/protocol";
import { useEffect, useId, useRef } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { Button } from "../components/Button.tsx";
import { CloseButton } from "../components/CloseButton.tsx";
import { Panel } from "../Panel.tsx";
import { permissionModeLabel } from "../spawn/permissionModes.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { useAgentSender } from "./agentCommands.ts";
import { flightKey, useAgentStore } from "./agentStore.ts";
import { isResumable, isRunning, PROVIDER_LABELS, STATUS_LABELS } from "./labels.ts";

function Facts({ robot }: { robot: RobotState }) {
  const rows: [string, string][] = [
    ["Status", STATUS_LABELS[robot.status]],
    ["Task", robot.taskTitle || "—"],
    [
      "Model",
      `${PROVIDER_LABELS[robot.provider]} · ${robot.model}${robot.effort ? ` (${robot.effort})` : ""}`,
    ],
    ["Owner", robot.ownerName || "—"],
  ];
  // How much it may do before it raises its hand (#166).
  if (robot.permissionMode)
    rows.splice(3, 0, ["Permissions", permissionModeLabel(robot.permissionMode)]);
  // Why it is in `error` (a short code and a redacted message, safe for every viewer).
  if (robot.statusReason) rows.splice(1, 0, ["Reason", robot.statusReason]);
  if (robot.worktreeBranch) rows.push(["Branch", robot.worktreeBranch]);
  if (robot.issueNumber) rows.push(["Issue", `#${robot.issueNumber}`]);
  if (robot.prNumber) rows.push(["Pull request", `#${robot.prNumber}`]);
  return (
    <dl className="rg-agent-facts">
      {rows.map(([k, v]) => (
        <div key={k} className="rg-agent-facts__row" data-key={k.toLowerCase()}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Controls({ robot }: { robot: RobotState }) {
  const agentId = robot.agentId;
  const send = useAgentSender();
  const promptId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const inFlight = useAgentStore((s) => s.inFlight);
  const pending = useAgentStore((s) => s.permissions[agentId]?.length ?? 0);
  const openPrompt = useAgentStore((s) => s.openPermissionPrompt);
  const openDialog = useAgentStore((s) => s.openDialog);
  const busy = (type: string) => Boolean(inFlight[flightKey(agentId, type)]);
  const running = isRunning(robot.status);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const input = box.current;
    const trimmed = input?.value.trim() ?? "";
    if (!input || !trimmed) return;
    send("agent.prompt", { agentId, text: trimmed });
    input.value = "";
  };

  return (
    <>
      {robot.handRaised && pending > 0 && (
        <Button variant="primary" block onClick={() => openPrompt(agentId)}>
          Review request{pending > 1 ? `s (${pending})` : ""}
        </Button>
      )}
      <form className="rg-agent-prompt" aria-label="Prompt the robot" onSubmit={submit}>
        <label className="rg-field__label" htmlFor={promptId}>
          Prompt
        </label>
        <textarea
          id={promptId}
          ref={box}
          className="rg-input rg-agent-textarea"
          rows={3}
          maxLength={20_000}
          disabled={!running}
          placeholder={running ? "Tell the robot what to do next" : "Resume the robot to prompt it"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
          }}
        />
        <div className="rg-agent-row">
          <span className="rg-field__hint">Ctrl+Enter to send</span>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!running || busy("agent.prompt")}
          >
            Send
          </Button>
        </div>
      </form>
      <div className="rg-agent-actions">
        {running && (
          <>
            <Button
              size="sm"
              disabled={busy("agent.interrupt")}
              onClick={() => send("agent.interrupt", { agentId })}
            >
              Interrupt
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy("agent.stop")}
              onClick={() => send("agent.stop", { agentId })}
            >
              Stop
            </Button>
          </>
        )}
        {isResumable(robot.status) && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy("agent.resume")}
            onClick={() => send("agent.resume", { agentId })}
          >
            Resume
          </Button>
        )}
        <Button size="sm" aria-haspopup="dialog" onClick={() => openDialog("pr")}>
          Open PR
        </Button>
        <Button size="sm" aria-haspopup="dialog" onClick={() => openDialog("sendHome")}>
          Send home
        </Button>
      </div>
    </>
  );
}

export function AgentPanel() {
  const agentId = useAgentStore((s) => s.panelAgentId);
  const close = useAgentStore((s) => s.closeAgentPanel);
  const refusal = useAgentStore((s) => (agentId ? s.refusal[agentId] : undefined));
  const robot = useFloorStore((s) => (agentId ? s.state?.robots[agentId] : undefined));
  const user = useSessionStore((s) => s.user);
  const openTerminal = useTerminalModal((s) => s.openTerminal);
  const titleId = useId();

  // The robot left (sent home, floor changed): close.
  useEffect(() => {
    if (agentId && !robot) close();
  }, [agentId, robot, close]);

  if (!agentId || !robot) return null;
  const controller = mayControlRobot(user, robot.ownerUserId);
  const inlineRefusal =
    refusal &&
    !["agent.pr", "agent.worktree", "agent.sendHome", "agent.approve"].includes(refusal.type);

  return (
    <Panel as="section" className="rg-agent-panel" aria-labelledby={titleId}>
      <div className="rg-agent-panel__head">
        <h2 id={titleId} className="rg-panel__title">
          {robot.taskTitle || "Robot"}
        </h2>
        <CloseButton small label="Close robot panel" onClick={close} />
      </div>
      <Facts robot={robot} />
      <Button size="sm" block aria-haspopup="dialog" onClick={() => openTerminal(agentId)}>
        {controller ? "Open terminal" : "Watch terminal"}
      </Button>
      {controller ? (
        <Controls robot={robot} />
      ) : (
        <p className="rg-field__hint">
          Only {robot.ownerName || "its owner"} or an admin can control this robot.
        </p>
      )}
      {inlineRefusal && (
        <div role="alert" className="rg-form-alert">
          {refusal.reason}
        </div>
      )}
    </Panel>
  );
}
