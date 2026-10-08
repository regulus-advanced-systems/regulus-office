/**
 * Office agents in the world (#252): their bodies, and what they want from a person.
 *
 * - geometry.ts   the lair's rooms and corridors per level, from the BuildingRoom state
 * - spots.ts      places a body on its own goes to, with a few words each
 * - follow.ts     where a personal agent stands beside its owner, or waits at a door
 * - wander.ts     which spot next, and for how long
 * - people.ts     where each person is, and where a henchman's owner is
 * - route.ts      scripted routes: stops, one after the other, skipping closed rooms
 * - rounds.ts     the office PM (#60): its post at reception and its rounds by the clock
 * - world.ts      `AgentWorld`: one body per agent, stepped from the BuildingRoom's sweep
 * - attention.ts  a person's open question, unread reply and owed answer per agent
 * - service.ts    dismiss, recall, "seen", with their rules
 * - routes.ts     REST
 */
export { AgentAttention } from "./attention.ts";
export { PmRounds, type RoundHenchman, roundHenchmanOf } from "./rounds.ts";
export type { Route, RouteStop, RouteVisit } from "./route.ts";
export { mountAgentWorldRoutes } from "./routes.ts";
export { AgentWorldService } from "./service.ts";
export type { AgentWorldDeps, OwnerWhereabouts, WorldAgent } from "./types.ts";
export { AgentWorld } from "./world.ts";
