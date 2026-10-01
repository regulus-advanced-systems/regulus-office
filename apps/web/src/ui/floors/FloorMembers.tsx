/**
 * The two halves of the floor settings panel: who has access now (change or
 * remove), and "Add people" (search office people by name, tick, choose the
 * access, add). Plain form controls, so everything works from the keyboard.
 */
import type { FloorAccess, FloorMemberInfo, OfficeUserInfo } from "@regulus/protocol";
import { useId, useMemo, useState } from "react";
import { Button } from "../components/Button.tsx";
import {
  ACCESS_LABELS,
  ACCESS_ORDER,
  addCandidates,
  effectiveGrant,
  isOfficeManagerRole,
} from "./floorSettings.ts";

function AccessSelect({
  value,
  onChange,
  label,
  viewerOnly,
  disabled,
}: {
  value: FloorAccess;
  onChange: (access: FloorAccess) => void;
  label: string;
  viewerOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      className="rg-select rg-member__access"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.value as FloorAccess)}
    >
      {ACCESS_ORDER.map((a) => (
        <option key={a} value={a} disabled={viewerOnly && a !== "view"}>
          {ACCESS_LABELS[a]}
        </option>
      ))}
    </select>
  );
}

export function MemberList({
  members,
  roles,
  meId,
  busy,
  onChange,
  onRemove,
}: {
  members: readonly FloorMemberInfo[];
  /** Office role by user id, when the people list has loaded. */
  roles: ReadonlyMap<string, OfficeUserInfo["role"]>;
  meId: string | undefined;
  busy: boolean;
  onChange: (member: FloorMemberInfo, access: FloorAccess) => void;
  onRemove: (member: FloorMemberInfo) => void;
}) {
  if (members.length === 0) {
    return <p className="rg-muted">No one has been added to this operation yet.</p>;
  }
  return (
    <ul className="rg-list" aria-label="People with access">
      {members.map((m) => {
        const viewer = roles.get(m.userId) === "viewer";
        return (
          <li key={m.userId} className="rg-member">
            <span className="rg-member__name">
              {m.displayName}
              {m.userId === meId && <span className="rg-muted"> (you)</span>}
              {viewer && <span className="rg-member__note">Office viewer: can only watch</span>}
            </span>
            <AccessSelect
              label={`Access for ${m.displayName}`}
              value={effectiveGrant(viewer ? "viewer" : undefined, m.access)}
              viewerOnly={viewer}
              disabled={busy}
              onChange={(access) => onChange(m, access)}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${m.displayName}`}
              disabled={busy}
              onClick={() => onRemove(m)}
            >
              Remove
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function AddPeople({
  people,
  members,
  busy,
  onAdd,
}: {
  people: readonly OfficeUserInfo[];
  members: readonly FloorMemberInfo[];
  busy: boolean;
  /** Resolves true when every grant succeeded (the selection is then cleared). */
  onAdd: (picked: OfficeUserInfo[], access: FloorAccess) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [access, setAccess] = useState<FloorAccess>("spawn");
  const searchId = useId();
  const candidates = useMemo(() => addCandidates(people, members, query), [people, members, query]);
  const anyone = useMemo(() => addCandidates(people, members, "").length > 0, [people, members]);
  const chosen = people.filter(
    (p) => picked.has(p.userId) && !members.some((m) => m.userId === p.userId),
  );

  const toggle = (userId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(userId)) next.add(userId);
      return next;
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (chosen.length === 0) return;
    if (await onAdd(chosen, access)) {
      setPicked(new Set());
      setQuery("");
    }
  };

  if (!anyone) {
    return (
      <p className="rg-muted">
        Everyone in the office can already use this operation. Invite more people to the office
        first.
      </p>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Add people">
      <div className="rg-field">
        <label className="rg-field__label" htmlFor={searchId}>
          Search people
        </label>
        <input
          id={searchId}
          type="search"
          className="rg-input"
          placeholder="Type a name"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      {candidates.length === 0 ? (
        <p className="rg-muted">No one matches “{query.trim()}”.</p>
      ) : (
        <ul className="rg-list rg-member-picker" aria-label="People to add">
          {candidates.map((p) => (
            <li key={p.userId}>
              <label className="rg-member-pick">
                <input
                  type="checkbox"
                  checked={picked.has(p.userId)}
                  onChange={() => toggle(p.userId)}
                />
                <span>{p.displayName}</span>
                <span className="rg-muted">
                  {p.role === "viewer" ? "viewer, can only watch" : p.role}
                  {p.email ? ` · ${p.email}` : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="rg-member-add">
        <AccessSelect label="Access for the people you add" value={access} onChange={setAccess} />
        <Button variant="primary" type="submit" disabled={busy || chosen.length === 0}>
          {chosen.length === 0
            ? "Add"
            : `Add ${chosen.length} ${chosen.length === 1 ? "person" : "people"}`}
        </Button>
      </div>
    </form>
  );
}

/** "Owners and admins always manage every floor: …" for the people who need no grant. */
export function OfficeManagersNote({ people }: { people: readonly OfficeUserInfo[] }) {
  const names = people.filter((p) => isOfficeManagerRole(p.role)).map((p) => p.displayName);
  if (names.length === 0) return null;
  return (
    <p className="rg-field__hint">
      Owners and admins can always manage every operation: {names.join(", ")}.
    </p>
  );
}
