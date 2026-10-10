/**
 * Which room a watched target belongs to (#253): who sees its findings and
 * where a fix goes. The list is the rooms this person can see; a target that
 * is in a room they cannot see shows as kept, without naming it (D26).
 */
import type { OperationSummary } from "@regulus/protocol";

/** `undefined`: keep what the server has (a room this person cannot see); `null`: no room. */
export type RoomChoice = string | null | undefined;

const KEEP = "__keep__";
const NONE = "__none__";

export interface RoomSelectProps {
  value: RoomChoice;
  onChange: (next: RoomChoice) => void;
  operations: readonly Pick<OperationSummary, "operationId" | "name">[];
  label: string;
  disabled?: boolean;
}

export function RoomSelect({ value, onChange, operations, label, disabled }: RoomSelectProps) {
  return (
    <select
      className="rg-input rg-watchdog__room"
      aria-label={label}
      disabled={disabled}
      value={value === undefined ? KEEP : (value ?? NONE)}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === KEEP ? undefined : v === NONE ? null : v);
      }}
    >
      {value === undefined && <option value={KEEP}>A room you cannot see (kept)</option>}
      <option value={NONE}>No room (admins only)</option>
      {operations.map((o) => (
        <option key={o.operationId} value={o.operationId}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** The choice a stored mapping starts as. */
export function roomChoice(mapping: {
  operationId: string | null;
  operationHidden: boolean;
}): RoomChoice {
  return mapping.operationHidden ? undefined : mapping.operationId;
}
