/**
 * Guards against drift between the zod state shapes (the TS source of truth)
 * and the Colyseus schema classes: field names must match in order, and a
 * fixture must survive hydrate → encode → decode → toJSON unchanged.
 */
import { describe, expect, test } from "bun:test";
import { ArraySchema, Decoder, Encoder, MapSchema, Schema, StateView } from "@colyseus/schema";
import type { z } from "zod";
import { AgentBubble } from "../agent-bubble.ts";
import * as blastDoor from "../blast-door.ts";
import * as building from "../building-state.ts";
import { WorldPos } from "../common.ts";
import * as compound from "../compound.ts";
import { buildingFixture, operationFixture } from "../fixtures.ts";
import * as operation from "../operation-state.ts";
import * as schemas from "./index.ts";
import { type SchemaClass, schemaFieldNames, schemaMetadata } from "./introspect.ts";

/** Every zod state object paired with its Colyseus class. */
const pairs: Array<[string, z.ZodObject, SchemaClass]> = [
  ["WorldPos", WorldPos, schemas.WorldPosSchema],
  ["GeniusLook", building.GeniusLook, schemas.GeniusLookSchema],
  ["HumanPresence", building.HumanPresence, schemas.HumanPresenceSchema],
  ["OperationSummary", building.OperationSummary, schemas.OperationSummarySchema],
  ["ClosedRoom", building.ClosedRoom, schemas.ClosedRoomSchema],
  ["ChatMessage", building.ChatMessage, schemas.ChatMessageSchema],
  ["JukeboxQueueEntry", building.JukeboxQueueEntry, schemas.JukeboxQueueEntrySchema],
  ["JukeboxState", building.JukeboxState, schemas.JukeboxStateSchema],
  ["TopHenchmanUsage", building.TopHenchmanUsage, schemas.TopHenchmanUsageSchema],
  ["UsageSummary", building.UsageSummary, schemas.UsageSummarySchema],
  ["PmState", building.PmState, schemas.PmStateSchema],
  ["TileRect", compound.TileRect, schemas.TileRectSchema],
  ["SpecialRoomState", compound.SpecialRoomState, schemas.SpecialRoomStateSchema],
  ["CompoundState", compound.CompoundState, schemas.CompoundStateSchema],
  ["LevelState", compound.LevelState, schemas.LevelStateSchema],
  ["BlastDoorState", blastDoor.BlastDoorState, schemas.BlastDoorStateSchema],
  ["BuildingState", building.BuildingState, schemas.BuildingStateSchema],
  ["BubbleEmits", operation.BubbleEmits, schemas.BubbleEmitsSchema],
  ["AgentBubble", AgentBubble, schemas.AgentBubbleSchema],
  ["HenchmanState", operation.HenchmanState, schemas.HenchmanStateSchema],
  ["DeskState", operation.DeskState, schemas.DeskStateSchema],
  ["DecorState", operation.DecorState, schemas.DecorStateSchema],
  ["QueueTask", operation.QueueTask, schemas.QueueTaskSchema],
  ["QueueSettings", operation.QueueSettings, schemas.QueueSettingsSchema],
  ["IssueCard", operation.IssueCard, schemas.IssueCardSchema],
  ["PullCard", operation.PullCard, schemas.PullCardSchema],
  ["ServiceState", operation.ServiceState, schemas.ServiceStateSchema],
  ["CarriedCard", operation.CarriedCard, schemas.CarriedCardSchema],
  ["RepoSummary", operation.RepoSummary, schemas.RepoSummarySchema],
  ["OperationState", operation.OperationState, schemas.OperationStateSchema],
];

/** Build a schema instance from a plain object using the class's field metadata. */
function hydrate(klass: SchemaClass, plain: Record<string, unknown>): Schema {
  const metadata = schemaMetadata(klass);
  const instance = new klass() as unknown as Record<string, unknown>;
  for (const name of schemaFieldNames(klass)) {
    const fieldType = metadata?.[metadata[name] as number]?.type as unknown;
    instance[name] = hydrateValue(fieldType, plain[name]);
  }
  return instance as unknown as Schema;
}

function hydrateValue(fieldType: unknown, value: unknown): unknown {
  if (typeof fieldType === "function" && Schema.is(fieldType as typeof Schema)) {
    return hydrate(fieldType as SchemaClass, value as Record<string, unknown>);
  }
  if (fieldType && typeof fieldType === "object" && "map" in fieldType) {
    const map = new MapSchema();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      map.set(k, hydrateValue(fieldType.map, v));
    }
    return map;
  }
  if (fieldType && typeof fieldType === "object" && "array" in fieldType) {
    const arr = new ArraySchema();
    for (const v of value as unknown[]) arr.push(hydrateValue(fieldType.array, v));
    return arr;
  }
  return value;
}

/** Bun's toEqual treats absent keys and `undefined` differently; normalise via JSON. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("Colyseus schema lockstep", () => {
  test.each(pairs)("%s: schema fields match the zod shape keys in order", (_n, zod, klass) => {
    expect(schemaFieldNames(klass)).toEqual(Object.keys(zod.shape));
  });

  test("every zod state shape has a Colyseus twin", () => {
    const exported: unknown[] = [...Object.values(building), ...Object.values(operation)];
    const zodObjects = exported.filter(
      (v): v is z.ZodObject => typeof v === "object" && v !== null && "shape" in v,
    );
    const paired = new Set(pairs.map(([, zod]) => zod));
    for (const obj of zodObjects) expect(paired.has(obj)).toBe(true);
  });

  test("building fixture round-trips through encode/decode", () => {
    const state = hydrate(schemas.BuildingStateSchema, buildingFixture);
    expect(plain(state.toJSON())).toEqual(plain(buildingFixture));
    // The building state is per viewer (#270): this viewer is shown everything.
    const typed = state as InstanceType<typeof schemas.BuildingStateSchema>;
    const encoder = new Encoder(state);
    const view = new StateView();
    for (const map of [typed.humans, typed.operations, typed.closedRooms, typed.levels]) {
      map.forEach((item: Schema) => view.add(item));
    }
    typed.usage.topHenchmen.forEach((row: Schema) => view.add(row));
    const it = { offset: 0 };
    encoder.encodeAll(it);
    const bytes = encoder.encodeAllView(view, it.offset, it);
    const decoded = new schemas.BuildingStateSchema();
    new Decoder(decoded).decode(bytes);
    const json = plain(decoded.toJSON());
    expect(json).toEqual(plain(buildingFixture));
    expect(building.BuildingState.safeParse(json).success).toBe(true);
  });

  test("a client without a view gets none of the per-viewer entries (#270)", () => {
    const state = hydrate(schemas.BuildingStateSchema, buildingFixture);
    const decoded = new schemas.BuildingStateSchema();
    new Decoder(decoded).decode(new Encoder(state).encodeAll());
    const json = plain(decoded.toJSON());
    expect(json.humans).toEqual({});
    expect(json.operations).toEqual({});
    expect(json.closedRooms).toEqual({});
    expect(json.levels).toEqual({});
    expect(json.usage.topHenchmen ?? []).toEqual([]);
    // What is the same for everyone still arrives.
    expect(json.chat).toEqual(plain(buildingFixture.chat));
    expect(json.compound).toEqual(plain(buildingFixture.compound));
  });

  test("operation fixture round-trips through encode/decode", () => {
    const state = hydrate(schemas.OperationStateSchema, operationFixture);
    expect(plain(state.toJSON())).toEqual(plain(operationFixture));
    const bytes = new Encoder(state).encodeAll();
    const decoded = new schemas.OperationStateSchema();
    new Decoder(decoded).decode(bytes);
    const json = plain(decoded.toJSON());
    expect(json).toEqual(plain(operationFixture));
    expect(operation.OperationState.safeParse(json).success).toBe(true);
  });
});
