/**
 * Laptops on every desk seat of the floor template (SPEC §9.4):
 * - occupied desks show the robot's screen as a CanvasTexture from the
 *   floor's screen feed, repainted at ~2 fps;
 * - free desks show a dark screen;
 * - the desk the local player is at shows the live terminal (drei Html),
 *   when the ≤ 2 live DOM panel budget allows it;
 * - clicking a laptop with a robot, or `E` at an occupied desk, opens the
 *   terminal modal (free desks are the spawn dialog's job, #29).
 */
import { useFrame } from "@react-three/fiber";
import type { FloorTemplate } from "@regulus/floor-layout";
import { LOBBY_FLOOR_ID } from "@regulus/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { officeServerUrl, toWebSocketUrl } from "../../net/serverUrl.ts";
import { useFloorStore } from "../../state/floor.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { PANEL_PRIORITY, usePanelBudget } from "../../ui/terminal/panelBudget.ts";
import { useTerminalModal } from "../../ui/terminal/terminalStore.ts";
import { fakeAgentId, fakeScreensCount, fakeScreenText } from "./fakeScreens.ts";
import { DESK_FOCUS_RADIUS, DESK_INTERACT_RADIUS, nearestSeat } from "./focus.ts";
import { Laptop } from "./Laptop.tsx";
import { LiveLaptopScreen } from "./LiveLaptopScreen.tsx";
import { laptopPlacements } from "./placement.ts";
import { ScreenFeedClient } from "./screenFeed.ts";
import { ScreenTextures } from "./screenTextures.ts";

export const LAPTOP_PANEL_ID = "laptop-live";
/** How often the player's desk focus is re-evaluated. */
const FOCUS_CHECK_MS = 250;

/** seatId -> agentId from the FloorRoom robots. */
function selectSeatAgents(
  state: ReturnType<typeof useFloorStore.getState>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const robot of Object.values(state.state?.robots ?? {})) out[robot.seatId] = robot.agentId;
  return out;
}

export interface LaptopLayerProps {
  template: FloorTemplate;
}

export function LaptopLayer({ template }: LaptopLayerProps) {
  const placements = useMemo(() => laptopPlacements(template), [template]);
  const deskSeats = useMemo(() => template.seats.filter((s) => s.kind === "desk"), [template]);
  const fake = useMemo(() => fakeScreensCount(window.location.search), []);
  const floorId = useFloorStore((s) => s.floorId);
  const liveAgents = useFloorStore(useShallow(selectSeatAgents));
  const seatAgents = useMemo(() => {
    if (fake === null) return liveAgents;
    const out: Record<string, string> = {};
    for (const s of deskSeats.slice(0, fake)) out[s.id] = fakeAgentId(s.id);
    return out;
  }, [fake, liveAgents, deskSeats]);

  const textures = useMemo(() => new ScreenTextures(), []);
  useEffect(() => () => textures.dispose(), [textures]);
  useEffect(() => {
    textures.retain(new Set(Object.values(seatAgents)));
  }, [textures, seatAgents]);

  // Screen text for the perf probe: fake robots scrolling fake output.
  useEffect(() => {
    if (fake === null) return;
    const ids = Object.values(seatAgents);
    let tick = 40;
    const timer = setInterval(() => {
      tick += 1;
      ids.forEach((id, i) => {
        textures.setText(id, fakeScreenText(i, tick + i * 3));
      });
    }, 250);
    return () => clearInterval(timer);
  }, [fake, seatAgents, textures]);

  // Screen text: one feed socket per floor, independent of which robots come and go.
  useEffect(() => {
    if (fake !== null || !floorId || floorId === LOBBY_FLOOR_ID) return;
    const feed = new ScreenFeedClient({
      wsBase: toWebSocketUrl(officeServerUrl()),
      floorId,
      onScreen: (agentId, text) => textures.setText(agentId, text),
      onRemoved: (agentId) => textures.setText(agentId, null),
    });
    feed.start();
    return () => feed.stop();
  }, [fake, floorId, textures]);

  // Desk focus: the occupied desk the player stands at.
  const [focusedSeat, setFocusedSeat] = useState<string | null>(null);
  const lastCheck = useRef(0);
  useFrame(() => {
    const now = performance.now();
    textures.flush(now);
    if (now - lastCheck.current < FOCUS_CHECK_MS) return;
    lastCheck.current = now;
    const player = usePlayerStore.getState();
    const seat = player.spawned
      ? nearestSeat(deskSeats, player, DESK_FOCUS_RADIUS, (s) => seatAgents[s.id] !== undefined)
      : null;
    const id = seat?.id ?? null;
    if (id !== focusedSeat) setFocusedSeat(id);
  });

  const focusedAgent = focusedSeat && fake === null ? seatAgents[focusedSeat] : undefined;
  const request = usePanelBudget((s) => s.request);
  const release = usePanelBudget((s) => s.release);
  const liveGranted = usePanelBudget((s) => s.granted.has(LAPTOP_PANEL_ID));
  useEffect(() => {
    if (!focusedAgent) return;
    request(LAPTOP_PANEL_ID, PANEL_PRIORITY.laptop);
    return () => release(LAPTOP_PANEL_ID);
  }, [focusedAgent, request, release]);

  const openTerminal = useTerminalModal((s) => s.openTerminal);
  const modalAgent = useTerminalModal((s) => s.agentId);
  const onHotkey = useCallback(
    (detail: { id: string }) => {
      if (detail.id !== "interact") return;
      const player = usePlayerStore.getState();
      if (!player.spawned) return;
      const seat = nearestSeat(deskSeats, player, DESK_INTERACT_RADIUS);
      const agentId = seat ? seatAgents[seat.id] : undefined;
      if (agentId) openTerminal(agentId);
    },
    [deskSeats, seatAgents, openTerminal],
  );
  useHotkeyEvents(onHotkey);

  return (
    <group name="laptops">
      {placements.map((p) => {
        const agentId = seatAgents[p.seatId];
        // The modal already shows this robot live: keep the laptop on its texture.
        const live =
          agentId && agentId === focusedAgent && liveGranted && modalAgent !== agentId ? (
            <LiveLaptopScreen agentId={agentId} />
          ) : undefined;
        return (
          <Laptop
            key={p.seatId}
            placement={p}
            texture={agentId ? textures.texture(agentId) : null}
            live={live}
            onSelect={agentId ? () => openTerminal(agentId) : undefined}
          />
        );
      })}
    </group>
  );
}
