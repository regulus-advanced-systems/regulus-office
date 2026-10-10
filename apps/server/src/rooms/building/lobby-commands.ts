/**
 * The building room's lobby features, apart from room.ts: the jukebox and
 * its clock-sync pings (#47), the lounge TV share (#48, screen-share.ts) and
 * the break-room coffee machine (#63, coffee.ts).
 * `applyLobbyCommand` handles one parsed command, or says it is not one of
 * these; a refusal comes back as a reason for the caller to send.
 */
import {
  type BuildingStateSchema,
  CLOCK_PONG_MESSAGE,
  type ClientCommand,
  type ClockPong,
  LOBBY_LEVEL_ID,
  SCREEN_SHARE_REJECTIONS,
} from "@regulus/protocol";
import type { JukeboxPlayer } from "../../jukebox/player.ts";
import type { RoomClient } from "../transport.ts";
import type { CoffeeMachine } from "./coffee.ts";
import type { ScreenShareRules } from "./screen-share.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;

export interface LobbyCommandDeps {
  jukebox?: JukeboxPlayer;
  screen: ScreenShareRules;
  coffee: CoffeeMachine;
  now: () => number;
}

export type LobbyResult = { handled: false } | { handled: true; reason?: string };

export function applyLobbyCommand(
  deps: LobbyCommandDeps,
  state: BuildingState,
  client: RoomClient,
  command: ClientCommand,
): LobbyResult {
  switch (command.type) {
    case "clock.ping": {
      // Receive and send time are the same instant here: the handler is synchronous.
      const t = deps.now();
      const pong: ClockPong = { id: command.id, t0: command.t0, t1: t, t2: t };
      client.send(CLOCK_PONG_MESSAGE, pong);
      return { handled: true };
    }
    case "jukebox.play":
    case "jukebox.pause":
    case "jukebox.seek":
    case "jukebox.enqueue":
    case "jukebox.skip":
    case "jukebox.remove":
    case "jukebox.volume":
    case "jukebox.duration": {
      if (!deps.jukebox) return { handled: true, reason: "the jukebox is not running" };
      const { userId, role, displayName } = client.user;
      const result = deps.jukebox.command(state.jukebox, { userId, role, displayName }, command);
      return result.ok ? { handled: true } : { handled: true, reason: result.reason };
    }
    case "screen.share.start":
    case "screen.share.stop": {
      // The lounge TV is in the lobby, on the lobby level; "in no project room" on
      // another level is that level's corridors and landing (#269).
      if (
        command.type === "screen.share.start" &&
        state.humans.get(client.sessionId)?.levelId !== LOBBY_LEVEL_ID
      )
        return { handled: true, reason: SCREEN_SHARE_REJECTIONS.notInLobby };
      const result = deps.screen.apply(state.humans, client.sessionId, client.user, command);
      return result.ok ? { handled: true } : { handled: true, reason: result.reason };
    }
    case "coffee.drink": {
      const human = state.humans.get(client.sessionId);
      if (!human) return { handled: true, reason: "not in the office" };
      // `state.compound` is the lobby level's layout, where the break room is.
      const result = deps.coffee.drink(client.sessionId, human, state.compound);
      return result.ok ? { handled: true } : { handled: true, reason: result.reason };
    }
    default:
      return { handled: false };
  }
}
