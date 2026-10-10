/** Refusals of the watchdog's REST API (#253): a code for the UI and a status. */
export type WatchdogErrorCode =
  | "owner_or_admin_required"
  | "not_found"
  | "no_such_room"
  | "room_not_yours"
  | "not_a_watchdog"
  | "engine_not_supported"
  | "master_key_required"
  | "private_key_required"
  | "too_many_hosts"
  | "nothing_offered"
  | "credential_required"
  | "conflict"
  | "not_configured"
  | "agent_unavailable"
  | "forbidden"
  | "fix_refused";

const STATUS: Readonly<Record<WatchdogErrorCode, number>> = {
  owner_or_admin_required: 403,
  forbidden: 403,
  room_not_yours: 403,
  credential_required: 403,
  not_found: 404,
  no_such_room: 404,
  not_a_watchdog: 400,
  engine_not_supported: 400,
  master_key_required: 409,
  private_key_required: 400,
  too_many_hosts: 409,
  nothing_offered: 409,
  conflict: 409,
  not_configured: 409,
  agent_unavailable: 409,
  fix_refused: 409,
};

/** A refusal with a code for the UI and, where it helps, a message that is safe to show. */
export class WatchdogError extends Error {
  override name = "WatchdogError";
  readonly status: number;
  constructor(
    readonly code: WatchdogErrorCode,
    message: string = code,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}
