/**
 * Office agents in the world (#252): their bodies, and what they want from a person.
 *
 * - geometry.ts   the lair's rooms and corridors per level, from the BuildingRoom state
 * - spots.ts      places a body on its own goes to, with a few words each
 * - follow.ts     where a personal agent stands beside its owner, or waits at a door
 * - wander.ts     which spot next, and for how long
 * - world.ts      `AgentWorld`: one body per agent, stepped from the BuildingRoom's sweep;
 *                 `setRoute` is where scripted routes plug in (#60)
 * - attention.ts  a person's open question, unread reply and owed answer per agent
 * - service.ts    dismiss, recall, "seen", with their rules
 * - routes.ts     REST
 */
export { AgentAttention } from "./attention.ts";
export { mountAgentWorldRoutes } from "./routes.ts";
export { AgentWorldService } from "./service.ts";
export { AgentWorld, type RouteStop, type WorldAgent } from "./world.ts";
