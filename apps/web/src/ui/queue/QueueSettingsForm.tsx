/** Room managers: how many queued tasks run at once, in the room and per person (#37). */
import { QUEUE_LIMIT_MAX, QUEUE_LIMIT_MIN, type QueueSettings } from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { Button } from "../components/Button.tsx";
import type { QueueSend } from "./QueuePanel.tsx";

const clamp = (n: number) =>
  Math.min(QUEUE_LIMIT_MAX, Math.max(QUEUE_LIMIT_MIN, Math.round(Number.isFinite(n) ? n : 1)));

const OPTIONS = Array.from({ length: QUEUE_LIMIT_MAX - QUEUE_LIMIT_MIN + 1 }, (_, i) => {
  const n = QUEUE_LIMIT_MIN + i;
  return (
    <option key={n} value={n}>
      {n}
    </option>
  );
});

export function QueueSettingsForm({
  settings,
  send,
}: {
  settings: QueueSettings;
  send: QueueSend;
}) {
  const id = useId();
  const [maxRunning, setMaxRunning] = useState(settings.maxRunning);
  const [maxPerOwner, setMaxPerOwner] = useState(settings.maxPerOwner);
  useEffect(() => {
    setMaxRunning(settings.maxRunning);
    setMaxPerOwner(settings.maxPerOwner);
  }, [settings.maxRunning, settings.maxPerOwner]);
  const changed = maxRunning !== settings.maxRunning || maxPerOwner !== settings.maxPerOwner;
  return (
    <form
      className="rg-queue__settings"
      aria-label="Queue settings"
      onSubmit={(e) => {
        e.preventDefault();
        send("queue.settings", { maxRunning: clamp(maxRunning), maxPerOwner: clamp(maxPerOwner) });
      }}
    >
      <label htmlFor={`${id}-room`}>Tasks running at once</label>
      <select
        id={`${id}-room`}
        value={maxRunning}
        onChange={(e) => setMaxRunning(clamp(Number(e.currentTarget.value)))}
      >
        {OPTIONS}
      </select>
      <label htmlFor={`${id}-owner`}>Per person</label>
      <select
        id={`${id}-owner`}
        value={maxPerOwner}
        onChange={(e) => setMaxPerOwner(clamp(Number(e.currentTarget.value)))}
      >
        {OPTIONS}
      </select>
      <Button size="sm" variant="secondary" type="submit" disabled={!changed}>
        Save
      </Button>
    </form>
  );
}
