/**
 * What the media session needs to know about the world, several times a
 * second (#48): where we and everyone else stand, which room each of us is
 * in, who has the TV, whether the TV is in range. Built from the stores;
 * pure so it is testable.
 */
import { type BuildingState, LOBBY_OPERATION_ID } from "@regulus/protocol";
import { type CompoundWorld, roomAt } from "../scene/compound/world.ts";
import { inTvRange, type TvSpot } from "../scene/tv/spot.ts";
import type { UiSettings } from "../ui/settings/settingsStorage.ts";
import type { MediaHuman, MediaView } from "./session.ts";

export interface ViewInput {
  state: Pick<BuildingState, "humans"> | null;
  sessionId: string | null;
  /** The local player (more current than our presence). */
  player: { x: number; z: number; spawned: boolean };
  world: CompoundWorld | null;
  tv: TvSpot | null;
  tvOpen: boolean;
  settings: Pick<UiSettings, "volume" | "voiceVolume" | "pushToTalk">;
}

export function mediaView(input: ViewInput): MediaView {
  const { state, sessionId, player, world } = input;
  const room = (x: number, z: number) => (world ? (roomAt(world, x, z)?.id ?? null) : null);
  const others: MediaHuman[] = [];
  let self: MediaHuman | null = null;
  for (const [id, h] of Object.entries(state?.humans ?? {})) {
    const mine = id === sessionId;
    const x = mine && player.spawned ? player.x : h.position.x;
    const z = mine && player.spawned ? player.z : h.position.z;
    const human: MediaHuman = {
      sessionId: id,
      x,
      z,
      roomId: room(x, z),
      operationId: h.operationId,
      sharingScreen: h.sharingScreen,
    };
    if (mine) self = human;
    else others.push(human);
  }
  const me = self as MediaHuman | null;
  return {
    self: me,
    others,
    lobbyId: LOBBY_OPERATION_ID,
    watchTv: input.tvOpen || (me ? inTvRange(input.tv, me.x, me.z, me.roomId) : false),
    voiceLevel: input.settings.volume * input.settings.voiceVolume,
    pushToTalk: input.settings.pushToTalk,
  };
}
