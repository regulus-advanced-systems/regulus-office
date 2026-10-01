/**
 * One workflow's definition (#155): trigger, filters, henchman, actions and
 * limits. Every action starts off. Approve can only be turned on by an
 * office owner/admin; `fix` is not available yet.
 */
import {
  INCLUDE_MODES,
  type IncludeMode,
  ISSUE_TRIGGER_ACTIONS,
  PR_TRIGGER_ACTIONS,
  WORKFLOW_PROMPT_VARIABLES,
  WORKFLOW_PROVIDERS,
  WORKFLOW_TRIGGER_KINDS,
  type WorkflowSpec,
  type WorkflowTrigger,
} from "@regulus/protocol";
import { Switch } from "../components/Switch.tsx";
import { Checks, Field, NumberField, PatternField, Select, TextField } from "./fields.tsx";
import { defaultTrigger, TRIGGER_LABELS } from "./workflowForm.ts";

const PROVIDER_LABELS = {
  "claude-code": "Claude Code (office API key)",
  codex: "Codex (office API key)",
};
const MODE_LABELS: Record<IncludeMode, string> = {
  exclude: "Leave out",
  include: "Include",
  only: "Only",
};

export interface EditorProps {
  spec: WorkflowSpec;
  onChange: (spec: WorkflowSpec) => void;
  canApprove: boolean;
}

function TriggerFields({
  trigger,
  set,
}: {
  trigger: WorkflowTrigger;
  set: (t: WorkflowTrigger) => void;
}) {
  switch (trigger.kind) {
    case "pull_request":
      return (
        <Checks
          legend="When the pull request is"
          options={PR_TRIGGER_ACTIONS}
          value={trigger.actions}
          onChange={(actions) => set({ ...trigger, actions })}
        />
      );
    case "issues":
      return (
        <Checks
          legend="When the issue is"
          options={ISSUE_TRIGGER_ACTIONS}
          value={trigger.actions}
          onChange={(actions) => set({ ...trigger, actions })}
        />
      );
    case "command":
      return (
        <TextField
          label="Command"
          value={trigger.command}
          onChange={(command) => set({ ...trigger, command: command.toLowerCase() })}
          hint={`Someone with write access comments "/office ${trigger.command}" on a PR or review.`}
        />
      );
    case "push":
      return (
        <PatternField
          label="Branches"
          value={trigger.branches}
          onChange={(branches) => set({ ...trigger, branches })}
          hint="One per line; * and ** work."
        />
      );
    case "schedule":
      return (
        <>
          <TextField
            label="Cron (UTC)"
            value={trigger.cron}
            onChange={(cron) => set({ ...trigger, cron })}
            hint="minute hour day month weekday, e.g. 0 7 * * 1-5"
          />
          <TextField
            label="Branch"
            value={trigger.branch ?? ""}
            placeholder="default branch"
            onChange={(b) => set({ ...trigger, branch: b.trim() || undefined })}
          />
          <TextField
            label="Post the result on issue #"
            value={trigger.issueNumber ? String(trigger.issueNumber) : ""}
            placeholder="none: keep it in the run history"
            onChange={(n) =>
              set({ ...trigger, issueNumber: Number(n) > 0 ? Math.floor(Number(n)) : undefined })
            }
          />
        </>
      );
    case "check_failed":
      return (
        <p className="rg-field__hint">Runs when a check suite or check run fails or times out.</p>
      );
  }
}

export function WorkflowEditor({ spec, onChange, canApprove }: EditorProps) {
  const set = (patch: Partial<WorkflowSpec>) => onChange({ ...spec, ...patch });
  const f = spec.filters;
  const a = spec.actions;
  const setFilters = (patch: Partial<WorkflowSpec["filters"]>) =>
    set({ filters: { ...f, ...patch } });
  const setActions = (patch: Partial<WorkflowSpec["actions"]>) =>
    set({ actions: { ...a, ...patch } });
  const setHenchman = (patch: Partial<WorkflowSpec["henchman"]>) =>
    set({ henchman: { ...spec.henchman, ...patch } });
  const setLimits = (patch: Partial<WorkflowSpec["limits"]>) =>
    set({ limits: { ...spec.limits, ...patch } });

  return (
    <div className="rg-workflows__editor">
      <TextField label="Name" value={spec.name} onChange={(name) => set({ name })} />
      <Switch
        checked={spec.enabled}
        onChange={(enabled) => set({ enabled })}
        label="Enabled"
        hint="Off: nothing runs, but you can still dry-run it."
      />

      <h3 className="rg-workflows__heading">Trigger</h3>
      <Select
        label="Runs on"
        value={spec.trigger.kind}
        options={WORKFLOW_TRIGGER_KINDS.map((k) => ({ value: k, label: TRIGGER_LABELS[k] }))}
        onChange={(kind) => set({ trigger: defaultTrigger(kind) })}
      />
      <TriggerFields trigger={spec.trigger} set={(trigger) => set({ trigger })} />

      <h3 className="rg-workflows__heading">Filters</h3>
      <PatternField
        label="Base branches"
        value={f.baseBranches}
        onChange={(baseBranches) => setFilters({ baseBranches })}
        placeholder="any"
      />
      <PatternField
        label="Only with labels"
        value={f.labels.include}
        onChange={(include) => setFilters({ labels: { ...f.labels, include } })}
        placeholder="any"
      />
      <PatternField
        label="Not with labels"
        value={f.labels.exclude}
        onChange={(exclude) => setFilters({ labels: { ...f.labels, exclude } })}
      />
      <PatternField
        label="Only authors"
        value={f.authors.include}
        onChange={(include) => setFilters({ authors: { ...f.authors, include } })}
        placeholder="anyone"
      />
      <PatternField
        label="Not authors"
        value={f.authors.exclude}
        onChange={(exclude) => setFilters({ authors: { ...f.authors, exclude } })}
      />
      <PatternField
        label="Changed paths"
        value={f.paths.include}
        onChange={(include) => setFilters({ paths: { ...f.paths, include } })}
        placeholder="any, e.g. src/**"
      />
      <PatternField
        label="Ignore paths"
        value={f.paths.exclude}
        onChange={(exclude) => setFilters({ paths: { ...f.paths, exclude } })}
        placeholder="e.g. **/*.md"
      />
      <Select
        label="Bot authors"
        value={f.bots}
        options={INCLUDE_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
        onChange={(bots) => setFilters({ bots })}
      />
      <Select
        label="Draft PRs"
        value={f.drafts}
        options={INCLUDE_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
        onChange={(drafts) => setFilters({ drafts })}
      />

      <h3 className="rg-workflows__heading">Henchman</h3>
      <Select
        label="Provider"
        value={spec.henchman.provider}
        options={WORKFLOW_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
        onChange={(provider) => setHenchman({ provider })}
        hint="Workflow henchmen use only the office's pay-per-use API keys; usage is counted for the office."
      />
      <TextField
        label="Model"
        value={spec.henchman.model ?? ""}
        placeholder="provider default"
        onChange={(m) => setHenchman({ model: m.trim() || undefined })}
      />
      <TextField
        label="Effort"
        value={spec.henchman.effort ?? ""}
        placeholder="provider default"
        onChange={(e) => setHenchman({ effort: e.trim() || undefined })}
      />
      <Field
        label="Prompt template"
        htmlFor="rg-workflow-prompt"
        hint={`Placeholders: ${WORKFLOW_PROMPT_VARIABLES.map((v) => `{{${v}}}`).join(" ")}. Text from GitHub is marked as untrusted for the henchman.`}
      >
        <textarea
          id="rg-workflow-prompt"
          className="rg-input rg-workflows__prompt"
          rows={8}
          value={spec.henchman.promptTemplate}
          onChange={(e) => setHenchman({ promptTemplate: e.currentTarget.value })}
        />
      </Field>
      <Switch
        checked={spec.henchman.executePrCode}
        onChange={(executePrCode) => setHenchman({ executePrCode })}
        label="Let the henchman run the PR's code"
        hint="Same-repo PRs only, never forks, inside the henchman's sandbox. Off: it only reads files."
      />
      <NumberField
        label="Time limit (minutes)"
        value={spec.henchman.timeoutMinutes}
        min={1}
        max={60}
        onChange={(timeoutMinutes) => setHenchman({ timeoutMinutes })}
      />

      <h3 className="rg-workflows__heading">Actions (all off until you turn them on)</h3>
      <Switch
        checked={a.review.enabled}
        onChange={(enabled) => setActions({ review: { ...a.review, enabled } })}
        label="Post a PR review"
        hint="Summary and inline comments, as the office's GitHub App."
      />
      {a.review.enabled && (
        <div className="rg-workflows__sub">
          <Switch
            checked={a.review.inlineComments}
            onChange={(inlineComments) => setActions({ review: { ...a.review, inlineComments } })}
            label="Inline comments"
          />
          <NumberField
            label="At most inline comments"
            value={a.review.maxInlineComments}
            min={0}
            max={50}
            onChange={(maxInlineComments) =>
              setActions({ review: { ...a.review, maxInlineComments } })
            }
          />
          <Switch
            checked={a.review.allowRequestChanges}
            onChange={(allowRequestChanges) =>
              setActions({ review: { ...a.review, allowRequestChanges } })
            }
            label="May request changes"
            hint="Never for fork PRs."
          />
        </div>
      )}
      <Switch
        checked={a.comment.enabled}
        onChange={(enabled) => setActions({ comment: { enabled } })}
        label="Post a comment"
        hint="On the PR or issue; on the commit for pushes."
      />
      <Switch
        checked={a.label.enabled}
        onChange={(enabled) => setActions({ label: { ...a.label, enabled } })}
        label="Add labels"
        hint="Only labels from the list below; never on fork PRs."
      />
      {a.label.enabled && (
        <PatternField
          label="Allowed labels"
          value={a.label.allowed}
          onChange={(allowed) => setActions({ label: { ...a.label, allowed } })}
        />
      )}
      <Switch
        checked={a.checkRun.enabled}
        onChange={(enabled) => setActions({ checkRun: { enabled } })}
        label="Neutral check run"
        hint="Shows the review on the commit; never blocks merging."
      />
      <Switch
        checked={a.approve.enabled}
        disabled={!canApprove && !a.approve.enabled}
        onChange={(enabled) => setActions({ approve: { enabled } })}
        label="Allow approving"
        hint={
          canApprove
            ? "The App's approval can count toward branch protection. Never for fork PRs."
            : "Only an office owner or admin can turn this on."
        }
      />
      <Switch
        checked={false}
        disabled
        onChange={() => {}}
        label="Push fixes"
        hint="Not available yet."
      />

      <h3 className="rg-workflows__heading">Limits</h3>
      <NumberField
        label="Runs at once"
        value={spec.limits.concurrency}
        min={1}
        max={5}
        onChange={(concurrency) => setLimits({ concurrency })}
      />
      <NumberField
        label="Runs per day"
        value={spec.limits.dailyMaxRuns}
        min={1}
        max={500}
        onChange={(dailyMaxRuns) => setLimits({ dailyMaxRuns })}
      />
      <NumberField
        label="Tokens per day"
        value={spec.limits.dailyTokenBudget}
        min={10_000}
        max={100_000_000}
        onChange={(dailyTokenBudget) => setLimits({ dailyTokenBudget })}
      />
      <NumberField
        label="Cooldown per PR (minutes)"
        value={spec.limits.cooldownMinutes}
        min={0}
        max={1440}
        onChange={(cooldownMinutes) => setLimits({ cooldownMinutes })}
        hint="Commands ignore it."
      />
    </div>
  );
}
