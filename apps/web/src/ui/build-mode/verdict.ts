/**
 * The ghost's verdict (#187): the server's answer for the spot when it has
 * one, else the local rules' (the same code), so the colour never waits on
 * the network. Shared by the console and the scene's ghost.
 */
import type { TileRect } from "@regulus/protocol";
import { useCompoundStore } from "../../state/compound.ts";
import { cachedLocalCheck, describeRefusal } from "./logic.ts";
import { ghostKey, useBuildModeStore } from "./store.ts";

export interface Verdict {
  state: "ok" | "refused" | "checking";
  text: string;
  /** The server already answered for this exact spot. */
  confirmed: boolean;
  /** Corridor tiles the room would add (the preview). */
  corridor: TileRect[];
  /** Rooms the ghost collides with or cuts off. */
  conflicts: string[];
}

/** The ghost's verdict: the server's answer for this spot, else the local rules'. */
export function useVerdict(): Verdict | null {
  const world = useCompoundStore((s) => s.world);
  const s = useBuildModeStore();
  if (!world || !s.intent) return null;
  const key = ghostKey(s);
  const skip = s.intent.kind === "move" ? s.intent.operationId : undefined;
  const server = s.server?.key === key ? s.server : null;
  const local = cachedLocalCheck(world, s.placement(), skip);
  const ok = server ? server.ok : local.ok;
  if (!ok) {
    const reason = server ? server.reason : local.reason;
    const conflicts = server ? server.conflicts : local.conflicts;
    return {
      state: "refused",
      text: describeRefusal(world, reason, conflicts),
      confirmed: Boolean(server),
      corridor: [],
      conflicts,
    };
  }
  // Corridors are 2 tiles wide and a tile is 2 m: its length in metres is its tile count.
  const metres = local.corridor.reduce((n, r) => n + r.w * r.d, 0);
  const corridor =
    metres > 0 ? ` A new corridor of about ${metres} m joins it up.` : " It opens onto a corridor.";
  return {
    state: server ? "ok" : "checking",
    text: `Clear to build.${corridor}`,
    confirmed: Boolean(server),
    corridor: local.corridor,
    conflicts: [],
  };
}
