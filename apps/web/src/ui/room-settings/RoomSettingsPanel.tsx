/**
 * Room settings panel stub (#182): desk count and decor style for room
 * managers, read-only for everyone else. Build mode (#187) mounts it; until
 * then it is only reachable from tests. Desks with a robot at them cannot be
 * removed, and the count never goes past what the room's size fits.
 */
import { DECOR_STYLE_SPECS } from "@regulus/floor-layout";
import {
  DECOR_STYLES,
  type DecorStyle,
  minDeskCountFor,
  type RoomSettingsInfo,
} from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { Button } from "../components/Button.tsx";
import { describeRoomSettingsError, type RoomSettingsApi } from "./api.ts";

export interface RoomSettingsPanelProps {
  floorId: string;
  api: RoomSettingsApi;
}

export function RoomSettingsPanel({ floorId, api }: RoomSettingsPanelProps) {
  const [info, setInfo] = useState<RoomSettingsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.get(floorId).then((res) => {
      if (!live) return;
      if (res.ok) setInfo(res.data);
      else setError(describeRoomSettingsError(res));
    });
    return () => {
      live = false;
    };
  }, [api, floorId]);
  if (!info) return <p role="status">{error ?? "Loading room settings…"}</p>;
  return (
    <RoomSettingsForm
      info={info}
      error={error}
      onSave={async (change) => {
        const res = await api.update(floorId, change);
        if (res.ok) {
          setInfo(res.data);
          setError(null);
        } else setError(describeRoomSettingsError(res));
      }}
    />
  );
}

export function RoomSettingsForm({
  info,
  error,
  onSave,
}: {
  info: RoomSettingsInfo;
  error: string | null;
  onSave(change: { deskCount?: number; decorStyle?: DecorStyle }): Promise<void> | void;
}) {
  const id = useId();
  const [deskCount, setDeskCount] = useState(info.deskCount);
  const [decorStyle, setDecorStyle] = useState<DecorStyle>(info.decorStyle);
  useEffect(() => {
    setDeskCount(info.deskCount);
    setDecorStyle(info.decorStyle);
  }, [info.deskCount, info.decorStyle]);
  const min = minDeskCountFor(info.occupiedDesks);
  const desksLocked = !info.canManage || !info.generated;
  const changed = deskCount !== info.deskCount || decorStyle !== info.decorStyle;
  const counts = Array.from({ length: info.maxDeskCount }, (_, i) => i + 1);
  return (
    <form
      aria-label="Room settings"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          ...(deskCount !== info.deskCount ? { deskCount } : {}),
          ...(decorStyle !== info.decorStyle ? { decorStyle } : {}),
        });
      }}
    >
      <label htmlFor={`${id}-desks`}>Desks (4 seats each)</label>
      <select
        id={`${id}-desks`}
        value={deskCount}
        disabled={desksLocked}
        onChange={(e) => setDeskCount(Number(e.currentTarget.value))}
      >
        {counts.map((n) => (
          <option key={n} value={n} disabled={n < min}>
            {n}
          </option>
        ))}
      </select>
      {info.size && (
        <p>
          This {info.size.width}×{info.size.depth} room fits up to {info.maxDeskCount} desks.
        </p>
      )}
      {!info.generated && <p>Desks can change once this room uses the new room layout.</p>}
      {info.occupiedDesks.length > 0 && (
        <p>Robots are working at desk {info.occupiedDesks.join(", ")}; those desks stay.</p>
      )}
      <label htmlFor={`${id}-style`}>Decor style</label>
      <select
        id={`${id}-style`}
        value={decorStyle}
        disabled={!info.canManage}
        onChange={(e) => setDecorStyle(e.currentTarget.value as DecorStyle)}
      >
        {DECOR_STYLES.map((s) => (
          <option key={s} value={s}>
            {DECOR_STYLE_SPECS[s].name}
          </option>
        ))}
      </select>
      <p>{DECOR_STYLE_SPECS[decorStyle].blurb}</p>
      {error && <p role="alert">{error}</p>}
      {info.canManage && (
        <Button size="sm" variant="secondary" type="submit" disabled={!changed}>
          Save
        </Button>
      )}
    </form>
  );
}
