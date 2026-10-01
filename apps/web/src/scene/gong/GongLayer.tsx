/**
 * The floor's merge gong (#43, SPEC D9): one GongObject per `gong` wall
 * anchor of the room layout, the FloorRoom's gong messages (gongSync.ts),
 * a manual bang on click or `E` in reach (walking over on click, like a
 * board), and a confetti burst from the gong when it rings. The robots'
 * celebration is theirs (scene/robots/cheer.ts). With reduced motion there
 * is no swing, confetti or sound; the gong still glows and merges toast.
 */
import type { RoomTemplate } from "@regulus/room-layout";
import { useCallback, useEffect, useMemo } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { usePlayerStore } from "../../state/player.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { Confetti, createConfettiBus } from "../robots/Confetti.tsx";
import { scopedName, toRoom, useRoomScope, walkInRoom } from "../roomScope.ts";
import type { GongLook } from "./BrassGongLook.tsx";
import { GongObject } from "./GongObject.tsx";
import { gongAnchors, gongInReach } from "./gongAnchor.ts";
import { useGongStore } from "./gongStore.ts";
import { bangGong, syncGong } from "./gongSync.ts";
import { GONG_CONFETTI } from "./timing.ts";

const send = (type: "gong.bang", payload: Record<string, never>) =>
  getOfficeClient().send(type, payload);

export function GongLayer({ template, look }: { template: RoomTemplate; look?: GongLook }) {
  const scope = useRoomScope();
  const gongs = useMemo(() => gongAnchors(template), [template]);
  const reducedMotion = useUiStore(selectReducedMotion);
  const reachId = usePlayerStore((s) =>
    s.spawned && scope.interactive
      ? (gongInReach(gongs, toRoom(scope, s))?.anchor.id ?? null)
      : null,
  );

  // Gong messages come from the room the player is in; one subscription is enough.
  useEffect(
    () => (scope.interactive ? syncGong({ client: getOfficeClient() }) : undefined),
    [scope.interactive],
  );

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || !scope.interactive) return;
        const player = toRoom(scope, usePlayerStore.getState());
        if (!player.spawned || !gongInReach(gongs, player)) return;
        detail.handled = true;
        bangGong(send);
      },
      [gongs, scope],
    ),
  );

  // Confetti out of the gong on every ring.
  const confetti = useMemo(() => createConfettiBus(), []);
  useEffect(
    () =>
      useGongStore.subscribe((s, prev) => {
        if (!s.ring || s.ring.id === prev.ring?.id || reducedMotion || !scope.interactive) return;
        for (const g of gongs) {
          confetti.pending.push({
            ...g.front,
            y: g.anchor.y + g.anchor.h / 2,
            count: GONG_CONFETTI,
          });
        }
      }),
    [gongs, confetti, reducedMotion, scope],
  );

  if (gongs.length === 0) return null;
  return (
    <group name={scopedName(scope, "gongs")}>
      {gongs.map((g) => (
        <GongObject
          key={g.anchor.id}
          wall={g.wall}
          anchor={g.anchor}
          inReach={reachId === g.anchor.id}
          reducedMotion={reducedMotion}
          look={look}
          onBang={() => {
            // Walk over while it rings, like a board or a desk click.
            walkInRoom(scope, g.stand.x, g.stand.z);
            bangGong(send);
          }}
        />
      ))}
      {!reducedMotion && <Confetti bus={confetti} name="gong-confetti" />}
    </group>
  );
}
