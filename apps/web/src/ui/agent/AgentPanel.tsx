/**
 * Henchman panel (#33): opened from the henchman or its desk (`openAgentPanel`,
 * called by the scene, #29). Everyone who can see the operation gets the
 * henchman's status, task, model and owner and can watch its terminal; its
 * owner alone (D12, #138) also gets the prompt box, the raised-hand
 * approval, interrupt / stop / resume, send home and the one-click PR.
 * Office owners/admins watching someone else's running henchman get only the
 * confirmed, audited emergency stop. The server checks every command again.
 */
import { type HenchmanState, mayControlHenchman, mayEmergencyStop } from "@regulus/protocol";
import { useEffect, useId, useRef } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { useSessionStore } from "../../state/session.ts";
import { useChangesWindow } from "../changes/changesStore.ts";
import { Button } from "../components/Button.tsx";
import { CloseButton } from "../components/CloseButton.tsx";
import { Panel } from "../Panel.tsx";
import { permissionModeLabel } from "../spawn/permissionModes.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { AGENT_LAMPS, lampBlinks, lampStyle } from "../theme/lamps.ts";
import { useAgentSender } from "./agentCommands.ts";
import { flightKey, useAgentStore } from "./agentStore.ts";
import { EmergencyStop } from "./EmergencyStop.tsx";
import { isResumable, isRunning, PROVIDER_LABELS, STATUS_LABELS } from "./labels.ts";

function Facts({ henchman }: { henchman: HenchmanState }) {
  const rows: [string, string][] = [
    ["Status", STATUS_LABELS[henchman.status]],
    ["Task", henchman.taskTitle || "—"],
    [
      "Model",
      `${PROVIDER_LABELS[henchman.provider]} · ${henchman.model}${henchman.effort ? ` (${henchman.effort})` : ""}`,
    ],
    ["Owner", henchman.ownerName || "—"],
  ];
  // How much it may do before it raises its hand (#166).
  if (henchman.permissionMode)
    rows.splice(3, 0, ["Permissions", permissionModeLabel(henchman.permissionMode)]);
  // Why it is in `error` (a short code and a redacted message, safe for every viewer).
  if (henchman.statusReason) rows.splice(1, 0, ["Reason", henchman.statusReason]);
  if (henchman.worktreeBranch) rows.push(["Branch", henchman.worktreeBranch]);
  if (henchman.issueNumber) rows.push(["Issue", `#${henchman.issueNumber}`]);
  if (henchman.prNumber) rows.push(["Pull request", `#${henchman.prNumber}`]);
  return (
    <dl className="rg-agent-facts">
      {rows.map(([k, v]) => (
        <div key={k} className="rg-agent-facts__row" data-key={k.toLowerCase()}>
          <dt>{k}</dt>
          <dd>
            {k === "Status" && (
              <span
                className="rg-lamp rg-agent-facts__lamp"
                data-blink={lampBlinks(henchman.status)}
                style={lampStyle(AGENT_LAMPS[henchman.status])}
                aria-hidden="true"
              />
            )}
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Controls({ henchman }: { henchman: HenchmanState }) {
  const agentId = henchman.agentId;
  const send = useAgentSender();
  const promptId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const inFlight = useAgentStore((s) => s.inFlight);
  const pending = useAgentStore((s) => s.permissions[agentId]?.length ?? 0);
  const openPrompt = useAgentStore((s) => s.openPermissionPrompt);
  const openDialog = useAgentStore((s) => s.openDialog);
  const busy = (type: string) => Boolean(inFlight[flightKey(agentId, type)]);
  const running = isRunning(henchman.status);

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
      {henchman.handRaised && pending > 0 && (
        <Button variant="primary" block onClick={() => openPrompt(agentId)}>
          Review request{pending > 1 ? `s (${pending})` : ""}
        </Button>
      )}
      <form className="rg-agent-prompt" aria-label="Prompt the henchman" onSubmit={submit}>
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
          placeholder={
            running ? "Tell the henchman what to do next" : "Resume the henchman to prompt it"
          }
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
        {isResumable(henchman.status) && (
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
  const henchman = useOperationStore((s) => (agentId ? s.state?.henchmen[agentId] : undefined));
  const user = useSessionStore((s) => s.user);
  const openTerminal = useTerminalModal((s) => s.openTerminal);
  const openChanges = useChangesWindow((s) => s.openChanges);
  const titleId = useId();

  // The henchman left (sent home, operation changed): close.
  useEffect(() => {
    if (agentId && !henchman) close();
  }, [agentId, henchman, close]);

  if (!agentId || !henchman) return null;
  const controller = mayControlHenchman(user, henchman.ownerUserId);
  const inlineRefusal =
    refusal &&
    !["agent.pr", "agent.worktree", "agent.sendHome", "agent.approve"].includes(refusal.type);

  return (
    <Panel as="section" className="rg-agent-panel" aria-labelledby={titleId}>
      <div className="rg-agent-panel__head">
        <h2 id={titleId} className="rg-panel__title">
          {henchman.taskTitle || "Henchman"}
        </h2>
        <CloseButton small label="Close henchman panel" onClick={close} />
      </div>
      <Facts henchman={henchman} />
      <Button size="sm" block aria-haspopup="dialog" onClick={() => openTerminal(agentId)}>
        {controller ? "Open terminal" : "Watch terminal"}
      </Button>
      {/* The changes window (#38): everyone on the operation reads it; the owner commits. */}
      <Button size="sm" block aria-haspopup="dialog" onClick={() => openChanges(agentId)}>
        {controller ? "Review changes" : "View changes"}
      </Button>
      {controller ? (
        <Controls henchman={henchman} />
      ) : (
        <>
          <p className="rg-field__hint">
            Only {henchman.ownerName || "its owner"} can control this henchman.
          </p>
          {mayEmergencyStop(user) && isRunning(henchman.status) && (
            <EmergencyStop henchman={henchman} />
          )}
        </>
      )}
      {inlineRefusal && (
        <div role="alert" className="rg-form-alert">
          {refusal.reason}
        </div>
      )}
    </Panel>
  );
}
