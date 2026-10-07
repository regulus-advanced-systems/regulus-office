/**
 * "Send to barracks" (#33, worded for the lair in #282; the code still says send home): confirm, choose whether to keep the henchman's branch, and
 * see which uncommitted changes would be lost (the worktree is removed
 * either way). On confirm the server stops the agent, releases the worktree
 * and frees the desk; everyone then sees the henchman carry its box to the
 * elevator (scene/henchmen/sendHome).
 */
import { useEffect, useId, useState } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { useAgentSender } from "./agentCommands.ts";
import { flightKey, useAgentStore } from "./agentStore.ts";
import { FileList } from "./FileList.tsx";
import { useAgentOverlay } from "./useAgentOverlay.ts";

export function SendHomeDialog() {
  const agentId = useAgentStore((s) => (s.dialog === "sendHome" ? s.panelAgentId : null));
  const close = useAgentStore((s) => s.closeDialog);
  const worktree = useAgentStore((s) => (agentId ? s.worktree[agentId] : undefined));
  const refusal = useAgentStore((s) => (agentId ? s.refusal[agentId] : undefined));
  const loading = useAgentStore((s) =>
    agentId ? Boolean(s.inFlight[flightKey(agentId, "agent.worktree")]) : false,
  );
  const busy = useAgentStore((s) =>
    agentId ? Boolean(s.inFlight[flightKey(agentId, "agent.sendHome")]) : false,
  );
  const henchman = useOperationStore((s) => (agentId ? s.state?.henchmen[agentId] : undefined));
  const send = useAgentSender();
  const [keepBranch, setKeepBranch] = useState(true);
  const name = useId();
  useAgentOverlay(agentId !== null, "agent-send-home");

  useEffect(() => {
    if (!agentId) return;
    setKeepBranch(true);
    send("agent.worktree", { agentId });
  }, [agentId, send]);

  if (!agentId) return null;
  const branch = worktree?.branch || henchman?.worktreeBranch || "";
  const dirty = worktree?.uncommitted ?? [];
  const worktreeError = refusal?.type === "agent.worktree" ? refusal.reason : null;

  return (
    <Modal
      open
      onClose={close}
      title="Send henchman to barracks"
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => send("agent.sendHome", { agentId, keepBranch })}
          >
            {busy ? "Sending to barracks…" : "Send to barracks"}
          </Button>
        </>
      }
    >
      <p>
        The henchman stops, packs up and leaves its desk
        {henchman?.taskTitle ? ` (“${henchman.taskTitle}”)` : ""}. Its worktree is removed.
      </p>
      <fieldset className="rg-field rg-agent-choice">
        <legend className="rg-field__label">Branch{branch ? ` ${branch}` : ""}</legend>
        <label>
          <input
            type="radio"
            name={name}
            checked={keepBranch}
            onChange={() => setKeepBranch(true)}
          />{" "}
          Keep the branch (you can still open a PR from it)
        </label>
        <label>
          <input
            type="radio"
            name={name}
            checked={!keepBranch}
            onChange={() => setKeepBranch(false)}
          />{" "}
          Delete the branch, here and on GitHub
        </label>
      </fieldset>
      {loading && <p className="rg-field__hint">Checking for uncommitted changes…</p>}
      {worktreeError && (
        <p className="rg-field__hint">Could not check the worktree: {worktreeError}</p>
      )}
      {dirty.length > 0 && (
        <div role="alert" className="rg-form-alert">
          {dirty.length} uncommitted change{dirty.length === 1 ? "" : "s"} will be lost:
          <FileList files={dirty} label="Uncommitted changes" />
        </div>
      )}
      {refusal?.type === "agent.sendHome" && (
        <div role="alert" className="rg-form-alert">
          {refusal.reason}
        </div>
      )}
    </Modal>
  );
}
