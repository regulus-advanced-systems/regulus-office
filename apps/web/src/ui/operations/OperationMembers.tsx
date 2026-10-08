/**
 * The two halves of the operation settings panel. Who can enter a room comes
 * from each person's own GitHub access to its repo (D27; #270), so nothing
 * here lets anyone in: a room manager can only limit a person to less than
 * GitHub gives them. "Limits" lists the people limited now (change or lift),
 * "Limit someone" searches office people by name. Plain form controls, so
 * everything works from the keyboard.
 */
import type { OfficeUserInfo, OperationAccess, OperationMemberInfo } from "@regulus/protocol";
import { useId, useMemo, useState } from "react";
import { Button } from "../components/Button.tsx";
import { ACCESS_LABELS, ACCESS_ORDER, addCandidates, effectiveGrant } from "./operationSettings.ts";

function AccessSelect({
  value,
  onChange,
  label,
  viewerOnly,
  disabled,
}: {
  value: OperationAccess;
  onChange: (access: OperationAccess) => void;
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
      onChange={(e) => onChange(e.currentTarget.value as OperationAccess)}
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
  members: readonly OperationMemberInfo[];
  /** Office role by user id, when the people list has loaded. */
  roles: ReadonlyMap<string, OfficeUserInfo["role"]>;
  meId: string | undefined;
  busy: boolean;
  onChange: (member: OperationMemberInfo, access: OperationAccess) => void;
  onRemove: (member: OperationMemberInfo) => void;
}) {
  if (members.length === 0) {
    return <p className="rg-muted">No one is limited in this room.</p>;
  }
  return (
    <ul className="rg-list" aria-label="People with a limit">
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
              label={`Limit for ${m.displayName}`}
              value={effectiveGrant(viewer ? "viewer" : undefined, m.access)}
              viewerOnly={viewer}
              disabled={busy}
              onChange={(access) => onChange(m, access)}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Lift the limit for ${m.displayName}`}
              disabled={busy}
              onClick={() => onRemove(m)}
            >
              Lift
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
  members: readonly OperationMemberInfo[];
  busy: boolean;
  /** Resolves true when every limit was set (the selection is then cleared). */
  onAdd: (picked: OfficeUserInfo[], access: OperationAccess) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [access, setAccess] = useState<OperationAccess>("view");
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
    return <p className="rg-muted">Everyone in the office already has a limit in this room.</p>;
  }
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Limit someone">
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
        <ul className="rg-list rg-member-picker" aria-label="People to limit">
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
        <AccessSelect label="Limit for the people you picked" value={access} onChange={setAccess} />
        <Button variant="primary" type="submit" disabled={busy || chosen.length === 0}>
          {chosen.length === 0
            ? "Limit"
            : `Limit ${chosen.length} ${chosen.length === 1 ? "person" : "people"}`}
        </Button>
      </div>
    </form>
  );
}

/** Where access to the room comes from, and what the limits below can and cannot do. */
export function AccessFromGitHubNote() {
  return (
    <p className="rg-field__hint">
      Who can enter this room comes from each person's own access to its repo on GitHub: read lets
      them watch, write lets them work here, admin lets them manage the room. That holds for office
      owners and admins too. A limit below can only lower what GitHub gives a person; it never lets
      anyone in.
    </p>
  );
}
