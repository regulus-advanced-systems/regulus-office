/**
 * Browser client for room settings (#182): read and change a room's desk
 * count and decor style. The server checks access, size and occupied desks;
 * this only carries the answer and words its refusals.
 */
import {
  RoomSettingsInfo,
  roomSettingsPath,
  type UpdateRoomSettingsRequest,
} from "@regulus/protocol";

export type RoomSettingsResult =
  | { ok: true; data: RoomSettingsInfo }
  | { ok: false; status: number; code: string; maxDeskCount?: number; desks?: number[] };

export interface RoomSettingsApiOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export function createRoomSettingsApi(options: RoomSettingsApiOptions = {}) {
  const base = options.baseUrl ?? "";

  async function call(method: "GET" | "PUT", operationId: string, body?: unknown) {
    const doFetch = options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${roomSettingsPath(operationId)}`, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" } as const;
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const b = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
      return {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error : `http_${res.status}`,
        maxDeskCount: typeof b.maxDeskCount === "number" ? b.maxDeskCount : undefined,
        desks: Array.isArray(b.desks) ? b.desks.filter((d) => typeof d === "number") : undefined,
      } as const;
    }
    const parsed = RoomSettingsInfo.safeParse(json);
    if (!parsed.success)
      return { ok: false, status: res.status, code: "unexpected_response" } as const;
    return { ok: true, data: parsed.data } as const;
  }

  return {
    get: (operationId: string): Promise<RoomSettingsResult> => call("GET", operationId),
    update: (operationId: string, change: UpdateRoomSettingsRequest): Promise<RoomSettingsResult> =>
      call("PUT", operationId, change),
  };
}

export type RoomSettingsApi = ReturnType<typeof createRoomSettingsApi>;

/** Human wording for a refused change. */
export function describeRoomSettingsError(err: Extract<RoomSettingsResult, { ok: false }>): string {
  switch (err.code) {
    case "network_error":
      return "Could not reach the office server. Check your connection and try again.";
    case "operation_manage_required":
      return "Only room managers can change room settings.";
    case "operation_not_found":
      return "This room is gone, or you no longer have access to it.";
    case "too_many_desks":
      return `This room fits at most ${err.maxDeskCount ?? "that many"} desks.`;
    case "desks_occupied":
      return `Henchmen are working at desk ${(err.desks ?? []).join(", ")}. Send them to barracks first, or keep those desks.`;
    case "room_not_generated":
      return "This room still uses its old fixed layout, so its desks cannot change yet. Its decor style can.";
    case "room_size_unknown":
      return "The office does not know this room's size yet, so its desks cannot change.";
    default:
      return "The room settings could not be saved. Try again.";
  }
}
