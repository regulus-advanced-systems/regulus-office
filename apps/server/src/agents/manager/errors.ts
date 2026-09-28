/**
 * Errors the AgentManager raises for callers (room commands, HTTP). Messages
 * are safe to show to the human: they never contain keys, tokens or paths
 * from another human's runner.
 */
export type AgentManagerErrorCode =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unavailable"
  | "failed";

export class AgentManagerError extends Error {
  override name = "AgentManagerError";

  constructor(
    readonly code: AgentManagerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** A reason string safe for `command.rejected`. */
export function rejectionReason(err: unknown): string {
  if (err instanceof AgentManagerError) return err.message;
  return "internal error";
}
