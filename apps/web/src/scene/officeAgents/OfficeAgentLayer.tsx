/**
 * Office agents in the world (SPEC §9.3, D22, D32; #252): every body of the
 * level being looked at, walking where the server sends it (walker.ts) in the
 * form chosen for the agent, with its name and the shared bubble over it
 * (scene/agentBubble; quiet-room rules of #283). A click on a body, or `E`
 * next to one, opens its chat as a window in the world, for those who may
 * talk to it; someone else's personal agent only says whose it is.
 *
 * Mounted once in the compound scene with the scene's nav grid. The lift
 * (#269) changes nothing here: a body that changes level is placed (`hop`).
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { OFFICE_AGENT_REACH } from "@regulus/protocol";
import type { NavGrid } from "@regulus/room-layout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { useBuildingStore } from "../../state/building.ts";
import { useLevelStore } from "../../state/level.ts";
import {
  bodiesOnLevel,
  bodyBubble,
  bodyCaption,
  bodyLight,
  bodyScale,
  canChatWith,
  isOwnBody,
  nearestBody,
  openBodyChat,
  useAgentAttention,
  useAgentChatWindow,
  type Viewer,
} from "../../state/officeAgents.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useSessionStore } from "../../state/session.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { anyWindowOpen } from "../../state/windows.ts";
import { openBubbleTarget } from "../../ui/agent/bubbleTarget.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { AgentOverhead } from "../agentBubble/AgentOverhead.tsx";
import { visibleBubble } from "../agentBubble/bubbleStyle.ts";
import { type OverheadField, useOverheadField } from "../agentBubble/overheadField.ts";
import { useQualityStore } from "../compound/quality.ts";
import { useVisibleStore } from "../compound/visibility.ts";
import { type CompoundWorld, isOpenRoom, roomAt, travelPose } from "../compound/world.ts";
import { HenchmanAvatar } from "../henchmen/HenchmanAvatar.tsx";
import { HENCHMAN_HEIGHT } from "../henchmen/rig.ts";
import { type BodyWalker, createBodyWalker } from "./walker.ts";

/** `E` reaches an agent this close, metres. */
export const AGENT_INTERACT_RADIUS = OFFICE_AGENT_REACH;
/** Above a standing agent's head. */
const OVERHEAD_GAP = 0.14;

type Walkers = Map<string, BodyWalker>;

function AgentBody({
  agentId,
  grid,
  world,
  field,
  viewer,
  walkers,
  still,
  far,
}: {
  agentId: string;
  grid: NavGrid;
  world: CompoundWorld;
  field: OverheadField;
  viewer: Viewer | null;
  walkers: Walkers;
  still: boolean;
  far: boolean;
}) {
  const body = useBuildingStore(
    useShallow((s) => {
      const b = s.state?.officeAgents?.[agentId];
      return b
        ? {
            agentId: b.agentId,
            name: b.name,
            ownerUserId: b.ownerUserId,
            ownerName: b.ownerName,
            appearance: b.appearance,
            status: b.status,
            mode: b.mode,
            post: b.post,
            doing: b.doing,
            x: b.target.x,
            z: b.target.z,
            heading: b.target.heading,
            hop: b.hop,
          }
        : null;
    }),
  );
  const attention = useAgentAttention((s) => s.byAgent[agentId]);
  const activityBubbles = useUiStore((s) => s.settings.activityBubbles);
  const toast = useUiStore((s) => s.toast);
  const group = useRef<Group>(null);
  const walker = useMemo(() => createBodyWalker(), []);
  const [moving, setMoving] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    walkers.set(agentId, walker);
    return () => {
      if (walkers.get(agentId) === walker) walkers.delete(agentId);
    };
  }, [walkers, agentId, walker]);

  // A new target from the server (or a new grid: a door opened, a room was built): plan the walk.
  const tx = body?.x;
  const tz = body?.z;
  const th = body?.heading;
  const hop = body?.hop;
  useEffect(() => {
    if (tx === undefined || tz === undefined || th === undefined || hop === undefined) return;
    // A room this viewer cannot see into: as far as its door, then out of sight.
    const room = roomAt(world, tx, tz);
    const door = room && !isOpenRoom(room) ? travelPose(room) : null;
    walker.retarget(grid, { x: tx, z: tz, heading: th, hop, door });
    const g = group.current;
    if (g) {
      g.position.set(walker.pose.x, 0, walker.pose.z);
      g.rotation.y = walker.pose.heading;
      // A placed body (a hop) does not step: the probes read where it was put.
      g.userData.x = walker.pose.x;
      g.userData.z = walker.pose.z;
    }
    setHidden(walker.hidden);
  }, [walker, grid, world, tx, tz, th, hop]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // A still body returns here: nothing per frame.
    if (!walker.step(Math.min(dt, 0.1))) return;
    g.position.set(walker.pose.x, 0, walker.pose.z);
    g.rotation.y = walker.pose.heading;
    g.userData.x = walker.pose.x;
    g.userData.z = walker.pose.z;
    if (walker.moving !== moving) setMoving(walker.moving);
    if (walker.hidden !== hidden) setHidden(walker.hidden);
  });

  if (!body) return null;
  const mine = isOwnBody(body, viewer);
  const canChat = canChatWith(body, viewer);
  const caption = bodyCaption(body, viewer);
  // A board helper is a small henchman (#56).
  const scale = bodyScale(body);
  const bubble = visibleBubble(bodyBubble(body, attention, viewer, !moving) ?? undefined, {
    activityBubbles,
  });

  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    if (!openBodyChat(body, viewer)) {
      toast({
        kind: "info",
        message:
          body.ownerUserId === ""
            ? `${body.name} is the office's agent. Viewers cannot talk to shared agents.`
            : `${body.name} is ${caption}. Only ${body.ownerName || "its owner"} can talk to it.`,
      });
    }
  };
  const over = (on: boolean) => {
    if (on) field.hoveredId = agentId;
    else if (field.hoveredId === agentId) field.hoveredId = null;
    document.body.style.cursor = on && canChat ? "pointer" : "";
  };

  return (
    <group
      ref={group}
      name={`office-agent-${agentId}`}
      visible={!hidden}
      // Read by the e2e scene probes (tests/e2e/officeAgentProbes.ts); plain data, no behaviour.
      userData={{
        agentId,
        name: body.name,
        caption,
        mode: body.mode,
        post: body.post,
        scale,
        appearance: body.appearance,
        own: mine,
        canChat,
        hidden,
        moving,
        x: walker.pose.x,
        z: walker.pose.z,
        // Where the server has sent it (it may still be on its way there).
        targetX: body.x,
        targetZ: body.z,
        bubbleKind: bubble?.kind ?? "none",
        bubbleText: bubble?.text ?? "",
      }}
      position={[walker.pose.x, 0, walker.pose.z]}
      rotation-y={walker.pose.heading}
      onClick={hidden ? undefined : click}
      onPointerOver={hidden ? undefined : () => over(true)}
      onPointerOut={hidden ? undefined : () => over(false)}
    >
      <group scale={scale}>
        <HenchmanAvatar
          skin={body.appearance}
          seed={agentId}
          animation={moving ? "walk" : "idle"}
          status={bodyLight(body.status)}
          gesture="none"
        />
      </group>
      {!far && !hidden && (
        <AgentOverhead
          id={agentId}
          name={body.name}
          bubble={bubble}
          position={[0, HENCHMAN_HEIGHT * scale + OVERHEAD_GAP, 0]}
          anchor={walker.pose}
          still={still}
          onOpen={openBubbleTarget}
          field={field}
          own={mine}
        />
      )}
    </group>
  );
}

export function OfficeAgentLayer({ grid, world }: { grid: NavGrid; world: CompoundWorld }) {
  const levelId = useLevelStore((s) => s.levelId);
  const ids = useBuildingStore(
    useShallow((s) => bodiesOnLevel(s.state, levelId).map((b) => b.agentId)),
  );
  const user = useSessionStore((s) => s.user);
  const viewer = useMemo<Viewer | null>(
    () => (user ? { id: user.id, role: user.role } : null),
    [user],
  );
  const reducedMotion = useUiStore(selectReducedMotion);
  const activityBubbles = useUiStore((s) => s.settings.activityBubbles);
  const lowQuality = useQualityStore((s) => s.quality === "low");
  const far = useVisibleStore((s) => s.far);
  const walkers = useMemo<Walkers>(() => new Map(), []);

  // What the labels need to stay quiet (#283), written once a frame.
  const field = useOverheadField();
  field.activityBubbles = activityBubbles;
  field.reducedMotion = reducedMotion;
  const at = useRef({ x: 0, z: 0 });
  useFrame(() => {
    const player = usePlayerStore.getState();
    at.current.x = player.x;
    at.current.z = player.z;
    field.viewer = player.spawned ? at.current : null;
    field.focusedId = useAgentChatWindow.getState().agentId;
  });

  // `E` next to an agent we may talk to opens its chat, when nothing else took the key: a
  // follower is always within reach, and must not keep its owner from a chair or a free desk.
  // So this looks only after every other listener has had the press.
  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact") return;
        queueMicrotask(() => {
          if (detail.handled || anyWindowOpen()) return;
          const player = usePlayerStore.getState();
          const bodies = useBuildingStore.getState().state?.officeAgents ?? {};
          if (!player.spawned) return;
          const near = [...walkers]
            .filter(([id, w]) => !w.hidden && bodies[id] && canChatWith(bodies[id], viewer))
            .map(([id, w]) => ({ id, x: w.pose.x, z: w.pose.z }));
          const hit = nearestBody(near, player, AGENT_INTERACT_RADIUS);
          const body = hit ? bodies[hit.id] : undefined;
          if (body) openBodyChat(body, viewer);
        });
      },
      [walkers, viewer],
    ),
  );

  return (
    <group name="office-agents">
      {ids.map((id) => (
        <AgentBody
          key={id}
          agentId={id}
          grid={grid}
          world={world}
          field={field}
          viewer={viewer}
          walkers={walkers}
          still={reducedMotion || lowQuality}
          far={far}
        />
      ))}
    </group>
  );
}
