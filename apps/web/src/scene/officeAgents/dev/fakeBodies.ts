/**
 * Fake office agent bodies for the dev harness (dev/office.html `agents=<n>`,
 * #252): `count` agents in mixed forms strolling a room, each sent to a new
 * spot every few seconds, as the server would. The first is the viewer's own
 * (it shows "answer ready"); the rest are a shared agent and other people's
 * assistants. Not part of the build.
 */
import { CHARACTER_FORM_IDS, type OfficeAgentBody } from "@regulus/protocol";

const NAMES = ["Moneypenny", "Number Two", "Q", "Oddjob", "Nick Nack", "Frau Farbissina"];
/** Seconds between two targets of one body. */
const LEG_SECONDS = 5;

/** A stable pseudo-random number in [0, 1) from two integers. */
function noise(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function fakeBodies(
  count: number,
  room: { x: number; z: number; w: number; d: number },
  seconds: number,
  viewerId = "me",
): Record<string, OfficeAgentBody> {
  const out: Record<string, OfficeAgentBody> = {};
  for (let i = 0; i < count; i++) {
    // Each body changes target at its own moment, so they do not all set off at once.
    const leg = Math.floor(seconds / LEG_SECONDS + i * 0.37);
    const agentId = `office-agent-${i + 1}`;
    out[agentId] = {
      agentId,
      name: NAMES[i % NAMES.length] ?? `Agent ${i + 1}`,
      ownerUserId: i === 0 ? viewerId : i % 3 === 1 ? "" : `user-${i}`,
      ownerName: i === 0 ? "You" : i % 3 === 1 ? "" : `Agent ${i}`,
      appearance: i === 0 ? "secretary" : (CHARACTER_FORM_IDS[i % CHARACTER_FORM_IDS.length] ?? ""),
      status: i % 4 === 2 ? "busy" : "ready",
      levelId: "lobby",
      operationId: "lobby",
      mode: i === 0 ? "follow" : "wander",
      target: {
        x: room.x + 1.5 + noise(i, leg) * (room.w - 3),
        z: room.z + 1.5 + noise(leg, i + 7) * (room.d - 3),
        heading: noise(i, leg + 3) * Math.PI * 2,
      },
      hop: 1,
      doing: i % 3 === 1 ? "looking over the crew" : "",
      dismissed: false,
    };
  }
  return out;
}
