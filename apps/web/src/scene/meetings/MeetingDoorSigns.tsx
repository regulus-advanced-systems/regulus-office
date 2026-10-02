/**
 * "Meeting in session" over the door of every visible room that holds one
 * (#50): a lit plate centred above the door on the corridor side, next to
 * the room's name plaque. Only meetings the viewer may see are known (the
 * office lists live meetings per operation access), so a closed room to which
 * the viewer has no access shows nothing more than its plaque.
 */
import type { MeetingSummary } from "@regulus/protocol";
import { useEffect, useMemo } from "react";
import { Euler } from "three";
import { useShallow } from "zustand/react/shallow";
import { useMeetingStore } from "../../ui/meetings/meetingStore.ts";
import { type CompoundWorld, doorCentre, type WorldRoom } from "../compound/world.ts";
import { WALL_HEIGHT, WALL_THICKNESS } from "../lair/dimensions.ts";
import { canvasTexture, DOOR_PX, paintDoor } from "./meetingSignTexture.ts";

const SIGN_W = 2.2;
const SIGN_H = (SIGN_W * DOOR_PX.h) / DOOR_PX.w;
const SIGN_Y = WALL_HEIGHT - 0.32;
const TILT = 0.5;
const OUT = WALL_THICKNESS + 0.04;

const OUTWARD: Readonly<Record<WorldRoom["doorSide"], { x: number; z: number; yaw: number }>> = {
  north: { x: 0, z: -1, yaw: Math.PI },
  south: { x: 0, z: 1, yaw: 0 },
  east: { x: 1, z: 0, yaw: Math.PI / 2 },
  west: { x: -1, z: 0, yaw: -Math.PI / 2 },
};

function DoorSign({
  room,
  meeting,
  tileMetres,
}: {
  room: WorldRoom;
  meeting: MeetingSummary;
  tileMetres: number;
}) {
  const lines = {
    status: meeting.status,
    pattern: meeting.pattern,
    round: meeting.round,
    rounds: meeting.rounds,
  };
  const key = JSON.stringify(lines);
  const texture = useMemo(() => canvasTexture(DOOR_PX, (ctx) => paintDoor(ctx, lines)), [key]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const c = doorCentre(room, tileMetres);
  const o = OUTWARD[room.doorSide];
  const rotation = useMemo(() => new Euler(-TILT, o.yaw, 0, "YXZ"), [o.yaw]);
  const out = OUT + (SIGN_H / 2) * Math.sin(TILT);
  return (
    <mesh
      name={`meeting-door-sign-${room.id}`}
      position={[c.x + o.x * out, SIGN_Y, c.z + o.z * out]}
      rotation={rotation}
      raycast={() => null}
    >
      <planeGeometry args={[SIGN_W, SIGN_H]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export function MeetingDoorSigns({
  world,
  visible,
}: {
  world: CompoundWorld;
  visible: ReadonlySet<string>;
}) {
  const meetings = useMeetingStore(useShallow((s) => Object.values(s.active)));
  const signs = meetings.flatMap((meeting) => {
    const room = world.rooms.find((r) => r.id === meeting.operationId && r.kind === "project");
    return room && visible.has(room.id) ? [{ room, meeting }] : [];
  });
  if (signs.length === 0) return null;
  return (
    <group name="meeting-door-signs">
      {signs.map(({ room, meeting }) => (
        <DoorSign key={room.id} room={room} meeting={meeting} tileMetres={world.tileMetres} />
      ))}
    </group>
  );
}
