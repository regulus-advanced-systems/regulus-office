/**
 * What an agent is and knows, on its card in Settings → Agents (#136): "Who
 * it is and how it works" (its soul, with preview and history), "What it
 * remembers" and "Notes". Each part loads when it is opened.
 *
 * Rendered only for those who may read them (D20): the person a personal
 * agent belongs to, or office owners and admins for a shared one. The line
 * under the heading says who that is.
 */
import type { OfficeAgentView } from "@regulus/protocol";
import { type ReactNode, useState } from "react";
import type { OfficeAgentsApi } from "./api.ts";
import { MEMORY_WORDS, mindPrivacy, NOTE_WORDS, SOUL_WORDS } from "./labels.ts";
import { MindEntries } from "./MindEntries.tsx";
import { SoulEditor } from "./SoulEditor.tsx";

function Part({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: () => ReactNode;
}) {
  // Nothing is fetched until the part is opened; once opened it stays mounted.
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="rg-office-agent__config rg-agent-mind__part"
      onToggle={(e) => e.currentTarget.open && setOpened(true)}
    >
      <summary>{label}</summary>
      <div className="rg-field__hint">{hint}</div>
      {opened && children()}
    </details>
  );
}

export function AgentMind({
  api,
  agent,
  now,
  operations = [],
  onSoulSaved,
}: {
  api: OfficeAgentsApi;
  agent: OfficeAgentView;
  now: number;
  /** The rooms the viewer can see, to name the rooms an entry is about (#301). */
  operations?: ReadonlyArray<{ operationId: string; name: string }>;
  onSoulSaved(): void;
}) {
  const shared = agent.owner.kind === "office";
  const running = agent.status !== "stopped" && agent.status !== "error";
  return (
    <section className="rg-agent-mind" aria-label={`What ${agent.name} is and knows`}>
      <div className="rg-field__hint" data-testid="agent-mind-privacy">
        {mindPrivacy(shared)}
      </div>
      <Part label={SOUL_WORDS.label} hint={SOUL_WORDS.hint}>
        {() => (
          <SoulEditor
            api={api}
            agentId={agent.id}
            agentName={agent.name}
            running={running}
            now={now}
            onSaved={onSoulSaved}
          />
        )}
      </Part>
      <Part label={MEMORY_WORDS.label} hint={MEMORY_WORDS.hint}>
        {() => (
          <MindEntries
            api={api}
            agentId={agent.id}
            kind="memory"
            now={now}
            operations={operations}
          />
        )}
      </Part>
      <Part label={NOTE_WORDS.label} hint={NOTE_WORDS.hint}>
        {() => (
          <MindEntries api={api} agentId={agent.id} kind="note" now={now} operations={operations} />
        )}
      </Part>
    </section>
  );
}
