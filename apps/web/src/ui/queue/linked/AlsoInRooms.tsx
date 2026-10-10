/**
 * "Also in these rooms" on the queue dialog (#257): the other rooms on this
 * level where the viewer may work. Ticking one makes the task a linked task:
 * a henchman and a draft pull request in each room.
 */
import type { OperationInfo } from "@regulus/protocol";
import { useId } from "react";

export interface AlsoInRoomsValue {
  operationIds: readonly string[];
  /** Also name private repos in each other's pull requests; off unless ticked. */
  namePrivateRepos: boolean;
}

export function AlsoInRooms({
  rooms,
  value,
  onChange,
  disabled,
}: {
  rooms: readonly OperationInfo[];
  value: AlsoInRoomsValue;
  onChange: (value: AlsoInRoomsValue) => void;
  disabled?: boolean;
}) {
  const id = useId();
  if (rooms.length === 0) return null;
  const toggle = (operationId: string, on: boolean) =>
    onChange({
      ...value,
      operationIds: on
        ? [...value.operationIds, operationId]
        : value.operationIds.filter((o) => o !== operationId),
    });
  return (
    <fieldset className="rg-queue__also" disabled={disabled}>
      <legend>Also in these rooms</legend>
      <p className="rg-queue__also-hint">
        One task across several repos: a henchman in each room with the same task text, and a draft
        pull request from each. Their notes come to you; you decide what to pass on.
      </p>
      <div className="rg-queue__also-rooms">
        {rooms.map((room) => {
          const repo = room.repos[0];
          return (
            <label key={room.operationId} htmlFor={`${id}-${room.operationId}`}>
              <input
                id={`${id}-${room.operationId}`}
                type="checkbox"
                checked={value.operationIds.includes(room.operationId)}
                onChange={(e) => toggle(room.operationId, e.target.checked)}
              />{" "}
              {room.name}
              {repo && (
                <span className="rg-queue__also-repo">
                  {" "}
                  {repo.owner}/{repo.name}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {value.operationIds.length > 0 && (
        <label htmlFor={`${id}-link`} className="rg-queue__also-link">
          <input
            id={`${id}-link`}
            type="checkbox"
            checked={value.namePrivateRepos}
            onChange={(e) => onChange({ ...value, namePrivateRepos: e.target.checked })}
          />{" "}
          Also name private repos in each other's pull requests. Each pull request lists the others
          in public repos anyway; with this, everyone who can read one of the private repos on
          GitHub sees the names of the others.
        </label>
      )}
    </fieldset>
  );
}
