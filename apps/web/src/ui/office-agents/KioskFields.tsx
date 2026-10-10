/**
 * Settings → Agents, for the "Board helper" job (#56): which room and which
 * board it stands at, and whether it runs like the office's project manager.
 * The rooms offered are the ones this person can see; the office refuses any
 * other.
 */
import { KIOSK_BOARD_LABELS, KIOSK_BOARDS, type KioskBoard } from "@regulus/protocol";
import { useId } from "react";
import { KIOSK_WORDS } from "./labels.ts";

export interface KioskChoice {
  operationId: string;
  board: KioskBoard;
  viaPm: boolean;
}

export function KioskFields({
  rooms,
  value,
  onChange,
}: {
  rooms: ReadonlyArray<{ operationId: string; name: string }>;
  value: KioskChoice;
  onChange: (next: KioskChoice) => void;
}) {
  const ids = { room: useId(), board: useId(), pm: useId() };
  if (rooms.length === 0) {
    return (
      <div className="rg-field__hint" data-testid="kiosk-no-rooms">
        {KIOSK_WORDS.noRooms}
      </div>
    );
  }
  return (
    <fieldset className="rg-office-agent__kiosk" data-testid="kiosk-fields">
      <legend className="rg-field__label">Where it stands</legend>
      <label className="rg-field__label" htmlFor={ids.room}>
        Room
      </label>
      <select
        id={ids.room}
        className="rg-input"
        value={value.operationId}
        onChange={(e) => onChange({ ...value, operationId: e.currentTarget.value })}
      >
        {rooms.map((room) => (
          <option key={room.operationId} value={room.operationId}>
            {room.name}
          </option>
        ))}
      </select>
      <label className="rg-field__label" htmlFor={ids.board}>
        Board
      </label>
      <select
        id={ids.board}
        className="rg-input"
        value={value.board}
        onChange={(e) => onChange({ ...value, board: e.currentTarget.value as KioskBoard })}
      >
        {KIOSK_BOARDS.map((board) => (
          <option key={board} value={board}>
            {KIOSK_BOARD_LABELS[board]}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">{KIOSK_WORDS.where}</div>
      <label className="rg-office-agent__check" htmlFor={ids.pm}>
        <input
          id={ids.pm}
          type="checkbox"
          checked={value.viaPm}
          onChange={(e) => onChange({ ...value, viaPm: e.currentTarget.checked })}
        />{" "}
        {KIOSK_WORDS.viaPm}
      </label>
      <div className="rg-field__hint">{KIOSK_WORDS.viaPmHint}</div>
    </fieldset>
  );
}
