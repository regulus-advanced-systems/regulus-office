/**
 * Browser client for the compound writes build mode uses (#181, #187):
 * check a ghost, place a new room (creates the operation), move a room. Tokens
 * of typed repos travel in the place request's body only and are not kept.
 */
import {
  COMPOUND_CHECK_API_PATH,
  COMPOUND_ROOMS_API_PATH,
  OperationHenchmanInfo,
  PLACEMENT_ERRORS,
  type PlacementCheckResponse,
  PlacementCheckResponse as PlacementCheckSchema,
  type PlacementError,
  type PlaceRoomRequest,
  PlaceRoomResponse,
  type RoomPlacement,
} from "@regulus/protocol";
import type { ApiFailure } from "../auth/api.ts";

export type CompoundFailure = ApiFailure & {
  /** A refused placement: why, and which rooms it collides with. */
  placement?: { reason: PlacementError; conflicts: string[] };
  /** A refused move: the henchmen still running in the room. */
  henchmen?: OperationHenchmanInfo[];
};
export type CompoundResult<T> = { ok: true; data: T } | CompoundFailure;

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const ANY: Parser<unknown> = { safeParse: (v) => ({ success: true, data: v }) };

function failure(status: number, body: unknown): CompoundFailure {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof b.error === "string" ? b.error.toLowerCase() : `http_${status}`;
  const out: CompoundFailure = { ok: false, status, code };
  const reason = b.reason;
  if (
    code === "placement_invalid" &&
    typeof reason === "string" &&
    (PLACEMENT_ERRORS as readonly string[]).includes(reason)
  ) {
    const conflicts = Array.isArray(b.conflicts)
      ? b.conflicts.filter((c): c is string => typeof c === "string")
      : [];
    out.placement = { reason: reason as PlacementError, conflicts };
  }
  if (Array.isArray(b.henchmen))
    out.henchmen = b.henchmen.flatMap((r) => {
      const p = OperationHenchmanInfo.safeParse(r);
      return p.success ? [p.data] : [];
    });
  if (typeof b.repo === "number") out.reason = `repo ${b.repo + 1}`;
  if (Array.isArray(b.fields))
    out.reason = b.fields.filter((f) => typeof f === "string").join(", ");
  return out;
}

export function createCompoundApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const base = options.baseUrl ?? "";
  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body: unknown,
  ): Promise<CompoundResult<T>> {
    const doFetch = options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) return failure(res.status, json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }
  return {
    /**
     * Would `placement` be valid: for a move, on the room's own level ignoring
     * room `operationId`; for a new room, on the grid of `levelId` (#268)?
     */
    check: (placement: RoomPlacement, operationId?: string, levelId?: string) =>
      call<PlacementCheckResponse>(
        "POST",
        COMPOUND_CHECK_API_PATH,
        PlacementCheckSchema,
        operationId ? { placement, operationId } : levelId ? { placement, levelId } : { placement },
      ),
    /** Create the operation with its room at `placement` (201: the operation and its room). */
    place: (request: PlaceRoomRequest) =>
      call<PlaceRoomResponse>("POST", COMPOUND_ROOMS_API_PATH, PlaceRoomResponse, request),
    /** Move or resize a room; refused while henchmen run in it. */
    move: (operationId: string, placement: RoomPlacement) =>
      call<unknown>("PATCH", `${COMPOUND_ROOMS_API_PATH}/${encodeURIComponent(operationId)}`, ANY, {
        placement,
      }),
  };
}

export type CompoundApi = ReturnType<typeof createCompoundApi>;
