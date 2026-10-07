/**
 * The hourly limit on messages to a shared agent (#271). A shared agent
 * answers on the office's metered key, so each person may send it only so
 * many messages an hour (an admin setting). Personal agents run on what their
 * owner chose and are not limited here.
 */
import { AuthHttpError } from "../auth/errors.ts";
import type { Conversations } from "./conversations.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "./store.ts";

/** The window of the per-person message limit on shared agents. */
export const MESSAGE_WINDOW_MS = 60 * 60_000;

export function checkMessageRate(
  deps: { store: OfficeAgentStore; conversations: Conversations; now?: () => number },
  row: OfficeAgentRow,
  userId: string,
): void {
  if (row.ownerUserId !== null) return;
  const limit = deps.store.settings().sharedMessagesPerHour;
  const now = (deps.now ?? Date.now)();
  const sent = deps.conversations.sentSince(row.id, userId, now - MESSAGE_WINDOW_MS);
  if (sent.length < limit) return;
  // Free again when the oldest message that still counts leaves the window.
  const oldest = sent[sent.length - limit] ?? now;
  const retryAfterSeconds = Math.max(1, Math.ceil((oldest + MESSAGE_WINDOW_MS - now) / 1000));
  throw new AuthHttpError(429, "message_rate_limited", { limit, retryAfterSeconds });
}
