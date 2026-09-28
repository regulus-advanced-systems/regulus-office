/** Floor object commands: queue.*, card.*, decor.* (SPEC §6). */
import { z } from "zod";
import { Count, Effort, GhNumber, Id, ModelName, PromptText } from "../common.ts";
import { CARD_KINDS, DECOR_KINDS, PROVIDER_IDS, TASK_KINDS } from "../enums.ts";

export const QueueAddCommand = z
  .object({
    type: z.literal("queue.add"),
    floorId: Id,
    repoId: Id,
    kind: z.enum(TASK_KINDS),
    refNumber: GhNumber.optional(),
    prompt: PromptText,
    provider: z.enum(PROVIDER_IDS),
    model: ModelName,
    effort: Effort.optional(),
    autoWorktree: z.boolean().default(true),
  })
  .refine((c) => c.kind === "freeform" || c.refNumber !== undefined, {
    message: "refNumber is required for issue and pr tasks",
    path: ["refNumber"],
  });

export const QueueReorderCommand = z.object({
  type: z.literal("queue.reorder"),
  taskId: Id,
  position: Count,
});

export const QueueCancelCommand = z.object({
  type: z.literal("queue.cancel"),
  taskId: Id,
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

const decorRect = {
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().max(20),
  h: z.number().positive().max(20),
};

/** Place an already uploaded image (`uploadId` from the REST upload endpoint). */
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

export const floorCommands = [
  QueueAddCommand,
  QueueReorderCommand,
  QueueCancelCommand,
  CardPickCommand,
  CardDropCommand,
  DecorPlaceCommand,
  DecorMoveCommand,
  DecorRemoveCommand,
] as const;
