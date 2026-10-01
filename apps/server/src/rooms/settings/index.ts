/**
 * Room settings (#182): desk count and decor style of a project room.
 *
 * Boot wiring:
 *   const roomSettings = new RoomSettingsService({ db, onChange });
 *   mountRoomSettingsRoutes(server.router, { auth, settings: roomSettings });
 */
export { mountRoomSettingsRoutes, ROOM_SETTINGS_ROUTE } from "./routes.ts";
export {
  type RoomSettingsDeps,
  RoomSettingsService,
  roomShapeOf,
  syncDeskRows,
} from "./service.ts";
