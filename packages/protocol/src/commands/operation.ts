/**
 * Operation object commands: queue.*, card.*, decor.*, gong.bang (SPEC §6;
 * queue.retry|settings: #37; gong.bang: #43).
 */
import { z } from "zod";
import { Count, Effort, GhNumber, Id, ModelName, PROMPT_MAX, ShortText } from "../common.ts";
import { CARD_KINDS, DECOR_KINDS, PROVIDER_IDS, TASK_KINDS } from "../enums.ts";
import { PermissionModeSchema } from "../permission-modes.ts";
import { QUEUE_LIMIT_MAX, QUEUE_LIMIT_MIN } from "../queue-api.ts";

/**
 * Queue a task on this room's queue (SPEC §5 `tasks`, §9.4; #37). The human
 * who queues it owns the henchman it spawns: their credentials, their runner.
 * An issue / PR task names its number; a freeform task needs a prompt (an
 * issue / PR task without one gets a prompt from the card). `profileId`
 * names the queuer's own credential profile or `office:<provider>`, never a
 * secret (SPEC §8).
 */
export const QueueAddCommand = z
  .object({
    type: z.literal("queue.add"),
    operationId: Id,
    repoId: Id,
    kind: z.enum(TASK_KINDS),
    refNumber: GhNumber.optional(),
    title: ShortText.optional(),
    prompt: z.string().trim().max(PROMPT_MAX).default(""),
    provider: z.enum(PROVIDER_IDS),
    model: ModelName,
    effort: Effort.optional(),
    permissionMode: PermissionModeSchema.optional(),
    profileId: Id.optional(),
    autoWorktree: z.boolean().default(true),
  })
  .refine((c) => c.kind === "freeform" || c.refNumber !== undefined, {
    message: "refNumber is required for issue and pr tasks",
    path: ["refNumber"],
  })
  .refine((c) => c.kind !== "freeform" || c.prompt.length > 0, {
    message: "a freeform task needs a prompt",
    path: ["prompt"],
  });

/** Move a queued task to `position` among the queued tasks (0 = next). */
export const QueueReorderCommand = z.object({
  type: z.literal("queue.reorder"),
  taskId: Id,
  position: Count,
});

/** Cancel a queued task, or let go of a running one (its henchman keeps running). */
export const QueueCancelCommand = z.object({
  type: z.literal("queue.cancel"),
  taskId: Id,
});

/** Put a failed or cancelled task back at the end of the queue (#37). */
export const QueueRetryCommand = z.object({
  type: z.literal("queue.retry"),
  taskId: Id,
});

/** Room managers: how many queued tasks may run at once, in the room and per owner (#37). */
export const QueueSettingsCommand = z.object({
  type: z.literal("queue.settings"),
  maxRunning: z.number().int().min(QUEUE_LIMIT_MIN).max(QUEUE_LIMIT_MAX),
  maxPerOwner: z.number().int().min(QUEUE_LIMIT_MIN).max(QUEUE_LIMIT_MAX),
});

/** Pluck a card from the issue / PR board and carry it. */
export const CardPickCommand = z.object({
  type: z.literal("card.pick"),
  cardKind: z.enum(CARD_KINDS),
  repoId: Id,
  number: GhNumber,
});

/** Put the carried card down; `seatId` when dropped on a desk (opens the spawn dialog client-side). */
export const CardDropCommand = z.object({
  type: z.literal("card.drop"),
  seatId: Id.optional(),
});

/** Bang the operation's merge gong by hand (#43); rate-limited on the server. */
export const GongBangCommand = z.object({
  type: z.literal("gong.bang"),
});

/**
 * Where a decor item hangs (#46, wall-pictures.ts): `x` metres along the
 * wall from its `from` end to the centre, `y` the centre's height, `w`/`h`
 * its size. The server checks it against the room layout.
 */
const decorRect = {
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().max(20),
  h: z.number().positive().max(20),
};

/** Place an already uploaded image (`uploadId` from the REST upload endpoint); only `picture` for now. */
export const DecorPlaceCommand = z.object({
  type: z.literal("decor.place"),
  kind: z.enum(DECOR_KINDS),
  wallId: Id,
  uploadId: Id,
  ...decorRect,
});

export const DecorMoveCommand = z.object({
  type: z.literal("decor.move"),
  decorId: Id,
  wallId: Id.optional(),
  ...decorRect,
});

export const DecorRemoveCommand = z.object({
  type: z.literal("decor.remove"),
  decorId: Id,
});

export const operationCommands = [
  QueueAddCommand,
  QueueReorderCommand,
  QueueCancelCommand,
  QueueRetryCommand,
  QueueSettingsCommand,
  CardPickCommand,
  CardDropCommand,
  GongBangCommand,
  DecorPlaceCommand,
  DecorMoveCommand,
  DecorRemoveCommand,
] as const;
