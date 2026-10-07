/**
 * The compound (SPEC §9.1, D21; #181): the `compound` row, room placement,
 * the build phase, the layout published in the BuildingRoom, and its REST.
 * Pure rules live in @regulus/room-layout `compound/`.
 *
 * Boot wiring (see src/index.ts):
 *   const compound = new CompoundService({ db, logger, config: loadCompoundConfig(),
 *     publish: (s) => rooms.building.setCompound(s), onRoomsChanged: ... });
 *   createOperations({ ..., placer: compound, onChange: (id) => { compound.operationChanged(id); ... } });
 *   compound.boot();   // migrates pre-compound operations into rooms on first run
 *   mountCompoundRoutes(server.router, { auth, compound, operations, lifecycle });
 */
export { type CompoundConfig, CompoundConfigError, loadCompoundConfig } from "./config.ts";
export { type EnsureCompoundResult, ensureCompound } from "./migrate.ts";
export {
  applyCompoundState,
  applyLevels,
  applyRoomFields,
  type CompoundSnapshot,
  type LevelSnapshot,
  type RoomFields,
  UNPLACED,
} from "./room-state.ts";
export { type CompoundRouteDeps, mountCompoundRoutes } from "./routes.ts";
export {
  CompoundService,
  type CompoundServiceDeps,
  type NewRoomColumns,
  type RoomPlacer,
} from "./service.ts";
