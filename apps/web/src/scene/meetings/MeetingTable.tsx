/**
 * A meeting in its room (#50): a war-table hologram over the desk pod the
 * members sit at (pattern, round, who has the floor, the token budget), a
 * projector beam from the table, and a marker over each henchman who has the
 * floor. Clicking the hologram in the player's room opens the meeting panel.
 * Drawn for every joined room the viewer may see; a few meshes per meeting.
 */
import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { RoomTemplate } from "@regulus/room-layout";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, type Group } from "three";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { liveMeetingIn, useMeetingStore } from "../../ui/meetings/meetingStore.ts";
import { scopedName, useRoomScope } from "../roomScope.ts";
import { meetingAnchor } from "./meetingAnchor.ts";
import { BOARD_PX, boardText, canvasTexture, paintBoard } from "./meetingSignTexture.ts";

const HOLO_Y = 2.45;
const HOLO_W = 1.7;
const HOLO_H = (HOLO_W * BOARD_PX.h) / BOARD_PX.w;
const TABLE_TOP = 0.78;
const MARKER_Y = 1.95;
const CYAN = "#7FF3E6";

function SpeakerMarker({ x, z, still }: { x: number; z: number; still: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g || still) return;
    const t = clock.getElapsedTime();
    g.position.y = MARKER_Y + Math.sin(t * 3) * 0.06;
    g.rotation.y = t * 1.5;
  });
  return (
    <group ref={ref} position={[x, MARKER_Y, z]} raycast={() => null}>
      <mesh rotation={[Math.PI, 0, 0]} raycast={() => null}>
        <coneGeometry args={[0.12, 0.22, 4]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function MeetingTable({
  template,
}: {
  template: Pick<RoomTemplate, "seats" | "obstacles">;
}) {
  const scope = useRoomScope();
  const meeting = useMeetingStore((s) => liveMeetingIn(s.active, scope.operationId));
  const still = useUiStore(selectReducedMotion);
  const seatIds = useMemo(
    () => (meeting ? meeting.members.map((m) => m.seatId).filter(Boolean) : []),
    [meeting],
  );
  const anchor = useMemo(() => meetingAnchor(template, seatIds), [template, seatIds]);
  const text = meeting ? boardText(meeting) : null;
  const key = JSON.stringify(text);
  const texture = useMemo(
    () => (text ? canvasTexture(BOARD_PX, (ctx) => paintBoard(ctx, text)) : null),
    [key],
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!meeting || !anchor || !text) return null;
  const speaking = meeting.members.filter((m) => meeting.speaking.includes(m.position));
  const beam = HOLO_Y - HOLO_H / 2 - TABLE_TOP;
  return (
    <group name={scopedName(scope, "meeting-table")}>
      <mesh position={[anchor.x, TABLE_TOP + beam / 2, anchor.z]} raycast={() => null}>
        <cylinderGeometry args={[0.05, 0.32, beam, 12, 1, true]} />
        <meshBasicMaterial
          color={CYAN}
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <Billboard position={[anchor.x, HOLO_Y, anchor.z]} lockX lockZ>
        <mesh
          name={scopedName(scope, "meeting-hologram")}
          onClick={(e) => {
            if (!scope.interactive) return;
            e.stopPropagation();
            useMeetingStore.getState().openPanel(meeting.id);
          }}
        >
          <planeGeometry args={[HOLO_W, HOLO_H]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      </Billboard>
      {speaking.map((m) => {
        const seat = anchor.seats.get(m.seatId);
        return seat ? <SpeakerMarker key={m.position} x={seat.x} z={seat.z} still={still} /> : null;
      })}
    </group>
  );
}
