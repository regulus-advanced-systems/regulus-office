/**
 * Team webhook channels (#42): rows in `notification_channels` with the
 * webhook URL or Telegram bot token envelope-encrypted by the secrets module
 * (AAD `notification_channel:<id>|webhook_secret`, so a ciphertext copied to
 * another row does not decrypt). Views never carry the secret; `target()`
 * decrypts it for exactly one delivery.
 */
import {
  type CreateNotificationChannel,
  NOTIFICATION_EVENTS,
  type NotificationChannelView,
  type NotificationEvent,
  type UpdateNotificationChannel,
  type WebhookKind,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { notificationChannels } from "../db/schema/index.ts";
import {
  decryptSecretToString,
  encryptSecret,
  type MasterKeyring,
  type SecretContext,
} from "../secrets/index.ts";
import type { ChannelTarget } from "./senders.ts";

type Row = typeof notificationChannels.$inferSelect;

export function channelSecretContext(channelId: string): SecretContext {
  return { userId: `notification_channel:${channelId}`, secretName: "webhook_secret" };
}

export interface RoutableChannel {
  id: string;
  kind: WebhookKind;
  chatId: string | null;
  operationIds: string[] | null;
  events: NotificationEvent[];
}

export class ChannelStoreError extends Error {
  override name = "ChannelStoreError";
  constructor(readonly code: "master_key_required" | "not_found" | "chat_id_required") {
    super(code);
  }
}

function parseList(json: string | null): string[] | null {
  if (json === null) return null;
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseEvents(json: string): NotificationEvent[] {
  return (parseList(json) ?? []).filter((e): e is NotificationEvent =>
    (NOTIFICATION_EVENTS as readonly string[]).includes(e),
  );
}

export class ChannelStore {
  readonly #db: Db;
  readonly #keyring: MasterKeyring | undefined;

  constructor(db: Db, keyring: MasterKeyring | undefined) {
    this.#db = db;
    this.#keyring = keyring;
  }

  get canStore(): boolean {
    return this.#keyring !== undefined;
  }

  #ring(): MasterKeyring {
    if (!this.#keyring) throw new ChannelStoreError("master_key_required");
    return this.#keyring;
  }

  #seal(channelId: string, secret: string): string {
    const ring = this.#ring();
    return encryptSecret(secret, channelSecretContext(channelId), ring.keys, ring.current);
  }

  #row(id: string): Row | undefined {
    return this.#db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .get();
  }

  static view(row: Row): NotificationChannelView {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      chatId: row.chatId,
      operationIds: parseList(row.operationIdsJson),
      events: parseEvents(row.eventsJson),
      enabled: row.enabled,
      lastDelivery:
        row.lastDeliveryAt && row.lastDeliveryCode
          ? {
              at: row.lastDeliveryAt.getTime(),
              ok: row.lastDeliveryOk === true,
              code: row.lastDeliveryCode,
            }
          : null,
      createdAt: row.createdAt.getTime(),
    };
  }

  list(): NotificationChannelView[] {
    return this.#db
      .select()
      .from(notificationChannels)
      .orderBy(notificationChannels.createdAt)
      .all()
      .map(ChannelStore.view);
  }

  get(id: string): NotificationChannelView | undefined {
    const row = this.#row(id);
    return row ? ChannelStore.view(row) : undefined;
  }

  /** Enabled channels for routing (no secrets). */
  routable(): RoutableChannel[] {
    return this.list()
      .filter((c) => c.enabled)
      .map(({ id, kind, chatId, operationIds, events }) => ({
        id,
        kind,
        chatId,
        operationIds,
        events,
      }));
  }

  create(input: CreateNotificationChannel, createdBy: string): NotificationChannelView {
    if (input.kind === "telegram" && !input.chatId) throw new ChannelStoreError("chat_id_required");
    const id = crypto.randomUUID();
    const encryptedSecret = this.#seal(id, input.secret);
    this.#db
      .insert(notificationChannels)
      .values({
        id,
        kind: input.kind,
        label: input.label,
        encryptedSecret,
        chatId: input.kind === "telegram" ? (input.chatId ?? null) : null,
        operationIdsJson: input.operationIds === null ? null : JSON.stringify(input.operationIds),
        eventsJson: JSON.stringify([...new Set(input.events)]),
        enabled: input.enabled ?? true,
        createdBy,
      })
      .run();
    return this.get(id) as NotificationChannelView;
  }

  update(id: string, patch: UpdateNotificationChannel): NotificationChannelView {
    const row = this.#row(id);
    if (!row) throw new ChannelStoreError("not_found");
    const set: Partial<typeof notificationChannels.$inferInsert> = {};
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.secret !== undefined) set.encryptedSecret = this.#seal(id, patch.secret);
    if (patch.chatId !== undefined && row.kind === "telegram") set.chatId = patch.chatId;
    if (patch.operationIds !== undefined) {
      set.operationIdsJson =
        patch.operationIds === null ? null : JSON.stringify(patch.operationIds);
    }
    if (patch.events !== undefined) set.eventsJson = JSON.stringify([...new Set(patch.events)]);
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (Object.keys(set).length > 0) {
      this.#db.update(notificationChannels).set(set).where(eq(notificationChannels.id, id)).run();
    }
    return this.get(id) as NotificationChannelView;
  }

  delete(id: string): boolean {
    const removed = this.#db
      .delete(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .returning({ id: notificationChannels.id })
      .all();
    return removed.length > 0;
  }

  /** Decrypt one channel's target for one delivery; null when gone or disabled. */
  target(id: string, opts: { includeDisabled?: boolean } = {}): ChannelTarget | null {
    const row = this.#row(id);
    if (!row || (!row.enabled && !opts.includeDisabled)) return null;
    const ring = this.#ring();
    const secret = decryptSecretToString(row.encryptedSecret, channelSecretContext(id), ring.keys);
    return { kind: row.kind, secret, chatId: row.chatId };
  }

  recordResult(id: string, ok: boolean, code: string, at: Date): void {
    this.#db
      .update(notificationChannels)
      .set({ lastDeliveryAt: at, lastDeliveryOk: ok, lastDeliveryCode: code.slice(0, 40) })
      .where(eq(notificationChannels.id, id))
      .run();
  }
}
