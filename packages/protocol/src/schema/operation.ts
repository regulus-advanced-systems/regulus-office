/**
 * Colyseus schema classes for the OperationRoom. Field names and order must
 * match the zod shapes in ../operation-state.ts (enforced by lockstep.test.ts).
 */
import { schema, t } from "@colyseus/schema";

export const BubbleEmitsSchema = schema(
  {
    toolCalls: t.uint32().default(0),
    fileEdits: t.uint32().default(0),
    testRuns: t.uint32().default(0),
    toolFailures: t.uint32().default(0),
  },
  "BubbleEmits",
);

export const HenchmanStateSchema = schema(
  {
    agentId: t.string().default(""),
    ownerUserId: t.string().default(""),
    ownerName: t.string().default(""),
    repoId: t.string().default(""),
    seatId: t.string().default(""),
    provider: t.string().default("custom"),
    model: t.string().default(""),
    effort: t.string().default(""),
    permissionMode: t.string().default(""),
    status: t.string().default("starting"),
    action: t.string().default("none"),
    taskTitle: t.string().default(""),
    taskSummary: t.string().default(""),
    issueNumber: t.uint32().default(0),
    prNumber: t.uint32().default(0),
    worktreeBranch: t.string().default(""),
    handRaised: t.boolean().default(false),
    statusReason: t.string().default(""),
    skin: t.string().default("standard"),
    bubbleEmits: BubbleEmitsSchema,
    lastActivityAt: t.number().default(0),
  },
  "HenchmanState",
);

export const DeskStateSchema = schema(
  {
    seatId: t.string().default(""),
    agentId: t.string().default(""),
  },
  "DeskState",
);

export const DecorStateSchema = schema(
  {
    id: t.string().default(""),
    kind: t.string().default("picture"),
    wallId: t.string().default(""),
    x: t.float64().default(0),
    y: t.float64().default(0),
    w: t.float64().default(1),
    h: t.float64().default(1),
    imageUrl: t.string().default(""),
    placedBy: t.string().default(""),
  },
  "DecorState",
);

export const QueueTaskSchema = schema(
  {
    id: t.string().default(""),
    position: t.uint16().default(0),
    kind: t.string().default("freeform"),
    refNumber: t.uint32().default(0),
    repoId: t.string().default(""),
    title: t.string().default(""),
    prompt: t.string().default(""),
    provider: t.string().default("custom"),
    model: t.string().default(""),
    effort: t.string().default(""),
    permissionMode: t.string().default(""),
    autoWorktree: t.boolean().default(true),
    state: t.string().default("queued"),
    agentId: t.string().default(""),
    prNumber: t.uint32().default(0),
    reason: t.string().default(""),
    createdBy: t.string().default(""),
    ownerName: t.string().default(""),
    createdAt: t.number().default(0),
    startedAt: t.number().default(0),
    finishedAt: t.number().default(0),
  },
  "QueueTask",
);

export const QueueSettingsSchema = schema(
  {
    maxRunning: t.uint8().default(2),
    maxPerOwner: t.uint8().default(2),
  },
  "QueueSettings",
);

const cardFields = {
  repoId: t.string().default(""),
  number: t.uint32().default(0),
  title: t.string().default(""),
  state: t.string().default("open"),
  labels: t.array("string"),
  assignees: t.array("string"),
  author: t.string().default(""),
  url: t.string().default(""),
  updatedAt: t.number().default(0),
};

export const IssueCardSchema = schema({ ...cardFields }, "IssueCard");

export const PullCardSchema = schema(
  {
    ...cardFields,
    draft: t.boolean().default(false),
    merged: t.boolean().default(false),
    headBranch: t.string().default(""),
    checksState: t.string().default("none"),
    reviewState: t.string().default("none"),
  },
  "PullCard",
);

export const ServiceStateSchema = schema(
  {
    id: t.string().default(""),
    agentId: t.string().default(""),
    port: t.uint16().default(0),
    url: t.string().default(""),
    title: t.string().default(""),
    pid: t.uint32().default(0),
    address: t.string().default(""),
    localOnly: t.boolean().default(false),
    shared: t.boolean().default(false),
    firstSeenAt: t.number().default(0),
    lastSeenAt: t.number().default(0),
  },
  "ServiceState",
);

export const CarriedCardSchema = schema(
  {
    sessionId: t.string().default(""),
    userId: t.string().default(""),
    cardKind: t.string().default("issue"),
    repoId: t.string().default(""),
    number: t.uint32().default(0),
    pickedAt: t.number().default(0),
  },
  "CarriedCard",
);

export const RepoSummarySchema = schema(
  {
    repoId: t.string().default(""),
    owner: t.string().default(""),
    name: t.string().default(""),
    defaultBranch: t.string().default("main"),
    isPrimary: t.boolean().default(false),
  },
  "RepoSummary",
);

export const OperationStateSchema = schema(
  {
    operationId: t.string().default(""),
    name: t.string().default(""),
    slug: t.string().default(""),
    paletteId: t.string().default(""),
    layoutTemplateId: t.string().default(""),
    repos: t.array(RepoSummarySchema),
    henchmen: t.map(HenchmanStateSchema),
    desks: t.map(DeskStateSchema),
    decor: t.map(DecorStateSchema),
    queue: t.array(QueueTaskSchema),
    issues: t.map(IssueCardSchema),
    pulls: t.map(PullCardSchema),
    services: t.map(ServiceStateSchema),
    whiteboardVersion: t.uint32().default(0),
    carriedCards: t.map(CarriedCardSchema),
    queueSettings: QueueSettingsSchema,
    deskCount: t.uint8().default(1),
    decorStyle: t.string().default("ops_room"),
  },
  "OperationState",
);
