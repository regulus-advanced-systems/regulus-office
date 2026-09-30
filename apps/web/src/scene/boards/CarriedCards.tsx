/**
 * Cards being carried on this floor (SPEC §9.4 "visible to all"; #36): a
 * paper card with its number held in front of each carrier. The carrier is
 * found by user id among the humans the scene draws (`local-human` for us,
 * `human-<sessionId>` for others), and the card follows that avatar's drawn
 * (interpolated) pose every frame.
 */
import { useFrame, useThree } from "@react-three/fiber";
import type { CardKind, CarriedCard } from "@regulus/protocol";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, DoubleSide, type Group, SRGBColorSpace } from "three";
import { useShallow } from "zustand/react/shallow";
import { useBuildingStore } from "../../state/building.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";

const CARD_W = 0.42;
const CARD_H = 0.56;
/** Held at chest height, a little in front of the avatar. */
const HOLD = { up: 0.95, forward: 0.32 };

const STRIPE: Readonly<Record<CardKind, string>> = { issue: "#3DA35D", pr: "#8250DF" };

function cardTexture(kind: CardKind, number: number): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#FFFDF5";
  ctx.fillRect(0, 0, 96, 128);
  ctx.fillStyle = STRIPE[kind];
  ctx.fillRect(0, 0, 96, 18);
  ctx.fillStyle = "#2B2B2B";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`#${number}`, 48, 66);
  ctx.fillStyle = "#9A9A9A";
  for (let i = 0; i < 3; i++) ctx.fillRect(16, 90 + i * 10, 64 - i * 12, 4);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function HeldCard({ card, carrier }: { card: CarriedCard; carrier: string }) {
  const group = useRef<Group>(null);
  const scene = useThree((s) => s.scene);
  const texture = useMemo(
    () => cardTexture(card.cardKind, card.number),
    [card.cardKind, card.number],
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const avatar = scene.getObjectByName(carrier);
    g.visible = Boolean(avatar);
    if (!avatar) return;
    const yaw = avatar.rotation.y;
    g.position.set(
      avatar.position.x + Math.sin(yaw) * HOLD.forward,
      HOLD.up,
      avatar.position.z + Math.cos(yaw) * HOLD.forward,
    );
    g.rotation.set(-0.25, yaw, 0.12);
  });
  return (
    <group ref={group} name={`carried-card-${card.sessionId}`} visible={false}>
      <mesh>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial
          map={texture}
          color={texture ? "#FFFFFF" : "#FFFDF5"}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function CarriedCards() {
  const cards = useFloorStore(useShallow((s) => Object.values(s.state?.carriedCards ?? {})));
  const myId = useSessionStore((s) => s.user?.id ?? null);
  const floorId = useFloorStore((s) => s.floorId);
  const humans = useBuildingStore(
    useShallow((s) => {
      const out: string[] = [];
      for (const [sid, h] of Object.entries(s.state?.humans ?? {})) {
        if (sid !== s.sessionId && h.floorId === floorId) out.push(`${h.userId}=${sid}`);
      }
      return out.sort();
    }),
  );
  const sessionOf = useMemo(
    () => new Map(humans.map((kv) => kv.split("=") as [string, string])),
    [humans],
  );
  return (
    <group name="carried-cards">
      {cards.map((card) => {
        const remote = sessionOf.get(card.userId);
        const carrier = card.userId === myId ? "local-human" : remote ? `human-${remote}` : null;
        return carrier ? <HeldCard key={card.sessionId} card={card} carrier={carrier} /> : null;
      })}
    </group>
  );
}
