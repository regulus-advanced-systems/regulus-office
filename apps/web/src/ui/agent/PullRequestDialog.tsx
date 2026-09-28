/**
 * "Open PR" (#33, SPEC §6 `agent.pr`): title and body prefilled from the
 * robot's task, a draft toggle, and the result: a link to the created (or
 * already open) PR, or the refusal, with the uncommitted files when the
 * worktree is dirty. Leaving the body empty lets the office draft it from
 * the commits.
 */
import type { RobotState } from "@regulus/protocol";
import { useId, useState } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { Switch } from "../components/Switch.tsx";
import { useAgentSender } from "./agentCommands.ts";
import { flightKey, useAgentStore } from "./agentStore.ts";
import { FileList } from "./FileList.tsx";
import { useAgentOverlay } from "./useAgentOverlay.ts";

/** Prefill: the task title, and the task summary plus `Closes #n` for an issue. */
export function draftFromRobot(robot: RobotState | undefined): { title: string; body: string } {
  if (!robot) return { title: "", body: "" };
  const body = [robot.taskSummary.trim(), robot.issueNumber ? `Closes #${robot.issueNumber}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return { title: robot.taskTitle.trim(), body };
}

export function PullRequestDialog() {
  const agentId = useAgentStore((s) => (s.dialog === "pr" ? s.panelAgentId : null));
  useAgentOverlay(agentId !== null, "agent-pr");
  // Keyed so every opening starts from a fresh draft of the robot's task.
  return agentId ? <PullRequestForm key={agentId} agentId={agentId} /> : null;
}

function PullRequestForm({ agentId }: { agentId: string }) {
  const close = useAgentStore((s) => s.closeDialog);
  const pr = useAgentStore((s) => s.pullRequest[agentId]);
  const refusal = useAgentStore((s) =>
    s.refusal[agentId]?.type === "agent.pr" ? s.refusal[agentId] : undefined,
  );
  const busy = useAgentStore((s) => Boolean(s.inFlight[flightKey(agentId, "agent.pr")]));
  const robot = useFloorStore((s) => s.state?.robots[agentId]);
  const send = useAgentSender();
  const ids = { form: useId(), title: useId(), body: useId() };
  // The robot keeps changing while the dialog is up; draft once.
  const [drafted] = useState(() => draftFromRobot(robot));
  const [draft, setDraft] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const opened = submitted && !busy ? pr : undefined;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const body = String(data.get("body") ?? "");
    setSubmitted(true);
    send("agent.pr", {
      agentId,
      draft,
      ...(title ? { title: title.slice(0, 200) } : {}),
      ...(body.trim() ? { body } : {}),
    });
  };

  return (
    <Modal
      open
      onClose={close}
      title="Open pull request"
      width={560}
      footer={
        opened ? (
          <Button variant="secondary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={ids.form} disabled={busy}>
              {busy ? "Opening…" : "Open PR"}
            </Button>
          </>
        )
      }
    >
      {opened ? (
        <div role="status">
          <p>
            {opened.created ? "Opened" : "Already open:"}{" "}
            <a href={opened.url} target="_blank" rel="noopener noreferrer">
              #{opened.number}
            </a>{" "}
            from <code>{opened.branch}</code>
            {opened.draft ? " (draft)" : ""}.
          </p>
        </div>
      ) : (
        <form id={ids.form} aria-label="Open pull request" onSubmit={submit}>
          <p className="rg-field__hint">
            Pushes <code>{robot?.worktreeBranch || "the robot's branch"}</code> with the floor's
            repo token and opens the PR on GitHub.
          </p>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={ids.title}>
              Title
            </label>
            <input
              id={ids.title}
              name="title"
              className="rg-input"
              maxLength={200}
              defaultValue={drafted.title}
              placeholder="Drafted from the task or the first commit"
            />
          </div>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={ids.body}>
              Description
            </label>
            <textarea
              id={ids.body}
              name="body"
              className="rg-input rg-agent-textarea"
              rows={6}
              maxLength={20_000}
              defaultValue={drafted.body}
              placeholder="Leave empty to draft it from the commits"
            />
          </div>
          <Switch
            checked={draft}
            onChange={setDraft}
            label="Draft"
            hint="Open as a draft pull request"
          />
          {refusal && (
            <div role="alert" className="rg-form-alert">
              {refusal.reason}
              {refusal.files && refusal.files.length > 0 && (
                <FileList files={refusal.files} label="Uncommitted changes" />
              )}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
